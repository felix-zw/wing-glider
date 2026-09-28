"""Rebuild Wing Glider's original hard-surface game assets with Blender 5.x.

Run from the repository root:
  blender --background --python tools/art/build_assets.py

Model coordinates in this script follow the game: X right, Y up, -Z forward.
The Blender authoring conversion and glTF exporter cancel one another out.
No third-party assets, fonts, textures, add-ons or network access are required.
"""

from pathlib import Path
import json
import math
import random
import sys

import bpy
import bmesh
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public" / "assets" / "models"
SOURCE = ROOT / "art"
PREVIEWS = SOURCE / "previews"
for directory in (OUTPUT, SOURCE, PREVIEWS):
    directory.mkdir(parents=True, exist_ok=True)


def position(v):
    return (v[0], -v[2], v[1])


def material(name, color, metallic=0, roughness=.5, glow=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if glow:
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = glow
    mat.diffuse_color = (*color, 1)
    return mat


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def palette():
    return {
        "ivory": material("ceramic | warm ivory", (.72, .68, .57), .24, .36),
        "chalk": material("ceramic | highlight", (.88, .84, .73), .16, .4),
        "orange": material("enamel | safety orange", (.81, .265, .052), .32, .34),
        "orange_dark": material("enamel | burnt orange", (.34, .083, .018), .38, .48),
        "graphite": material("frame | graphite", (.045, .062, .066), .64, .37),
        "steel": material("hardware | satin steel", (.22, .27, .27), .84, .31),
        "rubber": material("gaps | carbon", (.012, .017, .019), .15, .64),
        "glass": material("canopy | smoked blue", (.018, .048, .063), .7, .17),
        "mint": material("light | ion mint", (.18, .9, .82), .25, .2, 3),
        "amber": material("light | warm white", (1, .63, .24), .2, .2, 2.8),
    }


def finish(obj, mat, parent, bevel=0, smooth=False):
    obj.data.materials.append(mat)
    obj.parent = parent
    if bevel:
        modifier = obj.modifiers.new("Manufactured edge radius", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for poly in obj.data.polygons:
        poly.use_smooth = smooth
    if smooth:
        modifier = obj.modifiers.new("Weighted panel normals", "WEIGHTED_NORMAL")
        modifier.keep_sharp = True
        modifier.weight = 50
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def mesh(name, vertices, faces, mat, parent, bevel=0, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([position(v) for v in vertices], [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, mat, parent, bevel, smooth)


def box(name, center, dimensions, mat, parent, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position(center))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (dimensions[0], dimensions[2], dimensions[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, parent, bevel, True)


def cylinder(name, center, radius, depth, mat, parent, axis="y", sides=24, bevel=.02, radius2=None):
    if radius2 is None:
        radius2 = radius
    vertices = []
    for end, ringradius in ((-depth / 2, radius), (depth / 2, radius2)):
        for i in range(sides):
            angle = i * math.tau / sides
            c, s = ringradius * math.cos(angle), ringradius * math.sin(angle)
            local = (c, end, s) if axis == "y" else (c, s, end) if axis == "z" else (end, c, s)
            vertices.append(tuple(center[k] + local[k] for k in range(3)))
    faces = [tuple(reversed(range(sides))), tuple(range(sides, sides * 2))]
    faces += [(i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides)]
    # The winding of the X/Y plane for Z-axis cylinders is reversed.
    if axis == "y":
        faces = [tuple(reversed(face)) for face in faces]
    return mesh(name, vertices, faces, mat, parent, bevel, True)


def loft(name, sections, mat, parent, x=0, bevel=.015):
    """An eight-sided longitudinal hull: (z, half width, bottom, top)."""
    vertices = []
    for z, w, bottom, top in sections:
        h = top - bottom
        vertices += [(x + xx, yy, z) for xx, yy in [
            (-w * .74, top), (w * .74, top), (w, top - h * .22),
            (w, bottom + h * .22), (w * .72, bottom), (-w * .72, bottom),
            (-w, bottom + h * .22), (-w, top - h * .22),
        ]]
    faces = [tuple(reversed(range(8))), tuple(range((len(sections) - 1) * 8, len(sections) * 8))]
    for ring in range(len(sections) - 1):
        for j in range(8):
            a = ring * 8 + j
            b = ring * 8 + (j + 1) % 8
            faces.append((a, b, b + 8, a + 8))
    return mesh(name, vertices, faces, mat, parent, bevel, True)


def pod_loft(name, sections, mat, parent, x=0, bevel=.015):
    """Elliptical engine skin with sixteen radial facets and rounded normals."""
    vertices = []
    sides = 16
    for z, w, bottom, top in sections:
        for i in range(sides):
            angle = math.tau * i / sides
            vertices.append((x + w * math.cos(angle), (bottom + top) / 2 + (top - bottom) / 2 * math.sin(angle), z))
    faces = [tuple(reversed(range(sides))), tuple(range((len(sections) - 1) * sides, len(sections) * sides))]
    for ring in range(len(sections) - 1):
        for j in range(sides):
            a, b = ring * sides + j, ring * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    return mesh(name, vertices, faces, mat, parent, bevel, True)


def pod_skin(name, x, z_start, z_end, theta_start, theta_end, mat, parent, offset=.014):
    """A thin curved inset/decal follows the engine's elliptical clamshell."""
    vertices = []
    segments = 8
    for radial_offset in (offset, offset - .012):
        for z in (z_start, z_end):
            for i in range(segments + 1):
                theta = theta_start + (theta_end - theta_start) * i / segments
                vertices.append((x + (.61 + radial_offset) * math.cos(theta), .07 + (.51 + radial_offset) * math.sin(theta), z))
    ring = segments + 1
    faces = []
    for i in range(segments):
        faces += [(i, i + 1, i + 1 + ring, i + ring),
                  (i + 2 * ring, i + 3 * ring, i + 1 + 3 * ring, i + 1 + 2 * ring),
                  (i, i + 2 * ring, i + 1 + 2 * ring, i + 1),
                  (i + ring, i + 1 + ring, i + 1 + 3 * ring, i + 3 * ring)]
    faces += [(0, ring, 3 * ring, 2 * ring), (ring - 1, 3 * ring - 1, 4 * ring - 1, 2 * ring - 1)]
    return mesh(name, vertices, faces, mat, parent, .003, True)


def panel(name, corners, thickness, mat, parent, bevel=.015):
    vertices = list(corners) + [(x, y - thickness, z) for x, y, z in corners]
    n = len(corners)
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return mesh(name, vertices, faces, mat, parent, bevel, True)


def beam(name, start, end, thickness, mat, parent):
    a, b = Vector(position(start)), Vector(position(end))
    center = (a + b) / 2
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (thickness, thickness, (b - a).length)
    obj.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, parent, thickness * .18, True)


def empty(name, center=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = position(center)
    obj.parent = parent
    obj.empty_display_type = "ARROWS"
    obj.empty_display_size = .45
    return obj


def label(name, text, center, size, mat, parent, align="CENTER"):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = text
    curve.size = size
    curve.align_x = align
    curve.extrude = .0015
    curve.space_character = 1.1
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = position(center)
    obj.parent = parent
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def fasteners(points, mat, parent, radius=.035):
    for point in points:
        cylinder("Recessed hex fastener", point, radius, .015, mat, parent, sides=6, bevel=0)


def speeder():
    reset()
    m = palette()
    root = empty("speeder")
    root["asset_version"] = 1
    root["forward"] = "-Z"
    root["description"] = "WG-03 | Ivory twin-pod mineral survey speeder"

    # The graphite keel shows through the physical gaps between segmented armor.
    hull = [(-4.3, .14, -.31, -.13), (-3.15, .51, -.4, .12), (-1.7, .87, -.45, .43),
            (-.05, 1.06, -.45, .6), (1.72, 1.02, -.38, .57), (2.92, .79, -.3, .36)]
    loft("Continuous structural keel", [(z, w * .94, bottom, top - .08) for z, w, bottom, top in hull], m["graphite"], root, bevel=.035)
    armor_sections = [
        [(-4.24, .125, -.225, -.1), (-3.16, .50, -.32, .16), (-2.15, .76, -.32, .36)],
        [(-2.105, .77, -.31, .37), (-.1, 1.105, -.32, .635), (.68, 1.07, -.29, .63)],
        [(.725, 1.07, -.27, .615), (1.79, 1.01, -.25, .58), (2.9, .8, -.2, .39)],
    ]
    for i, section in enumerate(armor_sections):
        loft(f"Keel ceramic armor {i + 1}", section, m["ivory"], root, bevel=.025)
    panel("Nose graphite inset", [(-.07, -.076, -4.03), (.07, -.076, -4.03),
          (.225, .246, -2.67), (-.225, .246, -2.67)], .024, m["graphite"], root)
    panel("Nose access hatch", [(-.09, -.056, -3.91), (.09, -.056, -3.91),
          (.195, .208, -2.81), (-.195, .208, -2.81)], .018, m["steel"], root)
    box("Nose amber locator", (0, -.18, -4.302), (.17, .046, .025), m["amber"], root, .012)
    for side in (-1, 1):
        box("Recessed landing light housing", (side * .45, .183, -3.08), (.15, .1, .3), m["graphite"], root)
        box("Forward landing light", (side * .453, .237, -3.09), (.08, .013, .2), m["mint"], root, .006)
        beam("Lower exposed side rail", (side * .73, -.23, -1.8), (side * .94, -.2, 1.55), .105, m["steel"], root)

    # Smoked canopy is deliberately broad and legible from the gameplay camera.
    loft("Recessed canopy gasket", [(-2.58, .19, .27, .36), (-1.91, .48, .35, .77),
         (-.61, .68, .51, 1.02), (-.18, .61, .51, .93)], m["rubber"], root, bevel=.025)
    loft("Smoked faceted canopy", [(-2.46, .16, .35, .39), (-1.89, .425, .42, .785),
         (-.63, .60, .60, .998), (-.25, .55, .60, .91)], m["glass"], root, bevel=.018)
    beam("Canopy central mullion", (0, .399, -2.45), (0, .803, -1.89), .045, m["graphite"], root)
    beam("Canopy upper mullion", (0, .803, -1.89), (0, 1.023, -.63), .043, m["graphite"], root)
    for side in (-1, 1):
        beam("Canopy side frame", (side * .17, .391, -2.45), (side * .43, .79, -1.89), .056, m["steel"], root)
        beam("Canopy side frame", (side * .43, .79, -1.89), (side * .60, 1.004, -.63), .055, m["graphite"], root)
        beam("Canopy aft diagonal frame", (side * .60, 1.004, -.63), (side * .55, .918, -.25), .055, m["graphite"], root)
    beam("Canopy crossbar", (-.43, .797, -1.89), (.43, .797, -1.89), .055, m["graphite"], root)
    beam("Canopy aft crossbar", (-.55, .921, -.25), (.55, .921, -.25), .065, m["steel"], root)

    for side in (-1, 1):
        x = side * 2.37
        # Swept supports leave the negative space characteristic of the concept.
        for z, sweep in ((-1.35, .38), (1.49, .38)):
            panel("Graphite swept engine pylon", [(side * .75, -.09, z - .23), (side * .8, -.09, z + .23),
                  (side * 2.22, -.12, z + sweep + .24), (side * 2.22, -.12, z + sweep - .24)], .24, m["graphite"], root)
            panel("Pylon ceramic fairing", [(side * .94, .035, z - .17), (side * .98, .035, z + .17),
                  (side * 2.12, .02, z + sweep + .17), (side * 2.12, .02, z + sweep - .17)], .08, m["ivory"], root)
        pod_loft("Engine pod dark chassis", [(-3.13, .27, -.32, .22), (-2.67, .46, -.38, .37),
             (-1.75, .53, -.41, .46), (1.79, .52, -.38, .45), (2.92, .42, -.31, .34),
             (3.54, .29, -.24, .28)], m["graphite"], root, x=x, bevel=.025)
        podpanels = [
            [(-2.84, .46, -.37, .37), (-2.21, .585, -.46, .56), (-1.40, .61, -.45, .58)],
            [(-1.36, .61, -.44, .58), (.19, .61, -.44, .58)],
            [(.235, .61, -.44, .58), (1.71, .61, -.44, .58)],
            [(1.755, .61, -.44, .58), (2.71, .51, -.37, .48), (3.04, .46, -.34, .425)],
        ]
        for i, sections in enumerate(podpanels):
            pod_loft(f"Engine ceramic clamshell {i + 1}", sections, m["ivory"], root, x=x, bevel=.02)
        # Top orange panel and markings are physical, material-batched decals.
        pod_skin("Orange pod identification", x, -1.24, .12, math.pi / 2 - .63, math.pi / 2 + .63, m["orange"], root)
        for z in (-1.04, -.82, -.60):
            pod_skin("Ivory triple identifier", x, z, z + .105, math.pi / 2 - .27, math.pi / 2 + .27, m["chalk"], root, .031)
        cylinder("Intake surround", (x, -.01, -2.97), .345, .29, m["steel"], root, axis="z", radius2=.40)
        cylinder("Intake black well", (x, -.01, -3.134), .29, .045, m["rubber"], root, axis="z", bevel=.008)
        cylinder("Ion intake disc", (x, -.01, -3.16), .19, .025, m["mint"], root, axis="z", bevel=.008)
        cylinder("Aft turbine ring", (x, .0, 3.10), .425, .20, m["steel"], root, axis="z", radius2=.36)
        cylinder("Turbine nozzle", (x, .0, 3.38), .36, .36, m["graphite"], root, axis="z", radius2=.29)
        cylinder("Turbine inner liner", (x, .0, 3.565), .25, .03, m["rubber"], root, axis="z", bevel=.008)
        cylinder("Turbine emission core", (x, .0, 3.588), .19, .025, m["mint"], root, axis="z", bevel=.008)
        for a in range(8):
            angle = a * math.tau / 8
            beam("Nozzle radial rib", (x + .23 * math.cos(angle), .23 * math.sin(angle), 3.43),
                 (x + .30 * math.cos(angle), .30 * math.sin(angle), 3.09), .035, m["steel"], root)
        for z in (-1.05, -.78, -.51, -.24, .03):
            box("Inboard heat vent recess", (x - side * .575, .01, z), (.068, .28, .13), m["rubber"], root, .012)
            box("Vent fin", (x - side * .62, .01, z), (.035, .23, .032), m["steel"], root, .005)
        fasteners([(x + side * .30, .527, z) for z in (-1.22, .34, 1.6)], m["graphite"], root)
        empty("exhaust_left" if side == -1 else "exhaust_right", (x, 0, 3.62), root)
        suffix = "left" if side == -1 else "right"
        empty(f"reverse_{suffix}", (x, -.01, -3.20), root)
        for end, z in (("front", -1.6), ("aft", 1.6)):
            cylinder(f"Lateral turbine ring {suffix} {end}", (side * 2.94, .04, z), .17, .10,
                     m["steel"], root, axis="x", sides=16, bevel=.012)
            cylinder(f"Lateral turbine well {suffix} {end}", (side * 3.001, .04, z), .126, .025,
                     m["rubber"], root, axis="x", sides=16, bevel=.005)
            cylinder(f"Lateral turbine core {suffix} {end}", (side * 3.019, .04, z), .077, .013,
                     m["mint"], root, axis="x", sides=16, bevel=.003)
            empty(f"side_{suffix}_{end}", (side * 3.035, .04, z), root)

    # Cargo cassette and mechanical plumbing aft of the turret.
    loft("Cargo cassette underframe", [(1.43, .77, .48, .85), (2.80, .65, .34, .69)], m["graphite"], root)
    box("Cargo cassette top", (0, .837, 2.01), (1.16, .13, 1.21), m["ivory"], root, .06)
    box("Cargo cassette recessed lid", (0, .912, 1.96), (.94, .025, .9), m["chalk"], root, .025)
    for x in (-.51, .51):
        box("Cargo retaining rail", (x, .938, 2.0), (.055, .055, 1.12), m["steel"], root)
    for x in (-.34, .34):
        box("Cargo latch recess", (x, .958, 2.37), (.15, .025, .20), m["rubber"], root, .012)
        box("Cargo latch", (x, .973, 2.38), (.07, .03, .12), m["steel"], root, .008)
    label("Cargo identification", "WG / 03", (0, .929, 2.16), .14, m["graphite"], root)
    empty("cargo_socket", (0, .9, 2.02), root)

    cylinder("Turret bearing dark", (0, .674, .72), .70, .14, m["graphite"], root)
    cylinder("Turret bearing steel", (0, .76, .72), .62, .07, m["steel"], root)
    # Meshes are authored around zero; the pivot translation is held on the empty.
    turret = empty("mining_turret", (0, .80, .72), root)
    cylinder("Orange turret platter", (0, .07, 0), .57, .14, m["orange"], turret)
    cylinder("Turret top graphite hub", (0, .152, 0), .34, .025, m["graphite"], turret)
    box("Compact emitter housing", (0, .29, -.08), (.43, .24, .63), m["orange"], turret, .07)
    box("Emitter top inspection plate", (0, .419, -.03), (.28, .024, .27), m["steel"], turret, .025)
    cylinder("Emitter front sleeve", (0, .28, -.44), .105, .24, m["steel"], turret, axis="z", sides=16)
    cylinder("Slender mining emitter", (0, .28, -.72), .048, .45, m["graphite"], turret, axis="z", sides=12, bevel=.008)
    for z in (-.54, -.64, -.74, -.84):
        cylinder("Emitter ceramic collar", (0, .28, z), .065, .035, m["chalk"], turret, axis="z", sides=12, bevel=.006)
    cylinder("Emitter lens", (0, .28, -.968), .046, .035, m["mint"], turret, axis="z", sides=12, bevel=.004)
    for side in (-1, 1):
        cylinder("Turret side trunnion", (side * .23, .285, .01), .105, .04, m["steel"], turret, axis="x", sides=16)
        cylinder("Turret locator diode", (side * .252, .285, .01), .055, .025, m["mint"], turret, axis="x", sides=12)
        box("Turret platter recess", (side * .43, .145, .05), (.105, .025, .18), m["graphite"], turret, .016)
    empty("laser_socket", (0, .28, -.99), turret)
    fasteners([(-.42, .15, -.17), (.42, .15, -.17), (-.29, .15, .34), (.29, .15, .34)], m["steel"], turret)
    export_asset("speeder", root, 10.8, (7.8, 10.4, -11.5))


def crate(name, center, dimensions, m, parent, orange=True):
    x, y, z = center
    w, h, d = dimensions
    box(name + " graphite cage", center, dimensions, m["graphite"], parent, .12)
    box(name + " body", (x, y + .015, z), (w - .18, h + .02, d - .16), m["orange"] if orange else m["ivory"], parent, .065)
    for xx in (-w * .34, w * .34):
        box(name + " steel band", (x + xx, y + .055, z), (.10, h + .095, d + .055), m["steel"], parent, .015)
    box(name + " recessed lid", (x, y + h / 2 + .04, z), (w * .46, .04, d * .69), m["orange_dark"] if orange else m["graphite"], parent)
    for zz in (-d * .26, d * .26):
        box(name + " lid brace", (x, y + h / 2 + .075, z + zz), (w * .56, .035, .07), m["steel"], parent, .008)
    box(name + " label", (x, y + h / 2 + .10, z), (.35, .015, .23), m["chalk"], parent, .004)


def atlas():
    reset()
    m = palette()
    root = empty("atlas")
    root["asset_version"] = 1
    root["forward"] = "-Z"
    root["description"] = "ATLAS-07 | Expedition cargo tender"
    loft("ATLAS structural hull", [(-9.2, 1.0, 1.1, 2.3), (-7.1, 3.25, .85, 2.7),
         (-2.4, 3.35, .9, 2.55), (5.7, 3.22, .9, 2.48), (7.7, 2.65, 1.15, 2.42)], m["graphite"], root, bevel=.14)
    # Armored side sponsons make a frame around the sunken orange cargo deck.
    for side in (-1, 1):
        x = side * 2.95
        for z1, z2, top in ((-6.6, -2.6, 4.1), (-2.5, 1.75, 3.5), (1.85, 5.65, 3.5)):
            loft("ATLAS segmented side armor", [(z1, .60, 1.1, top), (z2, .60, 1.1, top - .24)],
                 m["ivory"], root, x=x, bevel=.075)
            box("ATLAS side armor inset", (x, top - .09, (z1 + z2) / 2), (.72, .05, (z2 - z1) * .69), m["chalk"], root, .04)
        loft("ATLAS front shoulder", [(-8.75, .28, 1.35, 2.7), (-6.72, .60, 1.1, 4.1)], m["ivory"], root, x=x * .81, bevel=.07)
        box("ATLAS side orange warning panel", (side * 3.572, 2.6, -1.15), (.075, .68, 1.7), m["orange"], root, .025)
        for z in (-4.3, -3.9, -3.5, -3.1):
            box("ATLAS side cooling recess", (side * 3.575, 2.3, z), (.10, .9, .18), m["rubber"], root, .035)
            box("ATLAS side cooling fin", (side * 3.64, 2.3, z), (.035, .75, .05), m["steel"], root, .006)
        beam("ATLAS external handrail", (side * 3.4, 3.66, -.85), (side * 3.4, 3.37, 5.0), .075, m["steel"], root)
        for z in (-.85, 2.2, 5.0):
            beam("ATLAS handrail stand", (side * 3.4, 3.35 - (z + 1) * .035, z), (side * 3.4, 3.62 - (z + 1) * .035, z), .07, m["steel"], root)
        # Four landing outriggers with hydraulic knees and broad pads.
        for z in (-5.0, 4.55):
            beam("Landing hydraulic upper", (side * 2.8, 1.45, z), (side * 4.35, .75, z + .3), .34, m["graphite"], root)
            beam("Landing hydraulic piston", (side * 3.05, 1.8, z), (side * 4.39, .87, z + .3), .13, m["steel"], root)
            cylinder("Landing pivot", (side * 3.1, 1.65, z), .30, .42, m["orange"], root, axis="x", sides=16)
            box("Landing strut knee", (side * 4.30, .65, z + .30), (.43, .8, .47), m["ivory"], root, .075)
            box("Broad landing pad", (side * 4.48, .18, z + .33), (1.3, .30, 1.65), m["graphite"], root, .11)
            box("Landing pad plate", (side * 4.48, .36, z + .33), (.94, .10, 1.32), m["steel"], root, .04)
        # Enclosed aft thrusters and compact cyan cores.
        cylinder("ATLAS engine mounting", (side * 2.65, 1.95, 6.6), .75, 2.2, m["ivory"], root, axis="z", sides=16, bevel=.05, radius2=.60)
        cylinder("ATLAS engine nozzle", (side * 2.65, 1.95, 7.72), .62, .55, m["graphite"], root, axis="z", sides=16, bevel=.03, radius2=.49)
        cylinder("ATLAS engine glow", (side * 2.65, 1.95, 8.005), .35, .04, m["mint"], root, axis="z", sides=16)

    loft("ATLAS bridge ceramic shell", [(-8.85, .90, 1.9, 2.85), (-7.0, 2.45, 2.4, 4.35),
         (-4.9, 2.42, 2.5, 4.66), (-3.55, 2.1, 2.5, 4.36)], m["ivory"], root, bevel=.11)
    loft("ATLAS panoramic bridge gasket", [(-7.2, 1.81, 3.34, 4.04), (-5.18, 1.92, 3.50, 4.76),
         (-4.76, 1.81, 3.51, 4.68)], m["graphite"], root, bevel=.055)
    loft("ATLAS panoramic bridge glass", [(-7.075, 1.70, 3.40, 4.035), (-5.21, 1.80, 3.59, 4.76),
         (-4.88, 1.70, 3.6, 4.67)], m["glass"], root, bevel=.045)
    for x in (-.8, 0, .8):
        beam("ATLAS windshield mullion", (x, 4.05, -7.08), (x, 4.785, -5.2), .065, m["steel"], root)
    box("ATLAS bridge roof service panel", (0, 4.64, -4.18), (2.45, .13, .83), m["chalk"], root, .06)
    label("ATLAS name", "ATLAS", (0, 4.725, -3.87), .47, m["graphite"], root)
    label("ATLAS registry", "07 / EXPEDITION", (0, 2.894, -8.69), .18, m["graphite"], root)
    box("Bow worklight housing", (0, 2.2, -8.9), (1.07, .34, .15), m["graphite"], root)
    box("Bow worklight", (0, 2.2, -8.992), (.85, .14, .03), m["amber"], root, .016)

    # The center deck and individual strapped crates are visible from overhead.
    box("Cargo deck", (0, 2.66, 1.4), (4.6, .34, 7.85), m["graphite"], root, .12)
    for z in (-1.7, .9, 3.5):
        crate("Orange cargo cassette", (0, 3.32, z), (3.8, 1.13, 2.13), m, root)
    for side in (-1, 1):
        for z in (-2.85, -.3, 2.25, 4.75):
            box("Cargo deck retaining shoe", (side * 2.11, 2.97, z), (.34, .48, .4), m["steel"], root, .04)
    box("Aft cargo door surround", (0, 1.93, 7.52), (3.3, 2.1, .28), m["ivory"], root, .10)
    box("Aft open cargo door", (0, 1.84, 7.695), (2.58, 1.56, .07), m["rubber"], root, .025)
    box("Aft cargo doorway light", (0, 2.665, 7.75), (2.5, .12, .06), m["mint"], root, .015)
    for side in (-1, 1):
        box("Aft doorway side light", (side * 1.32, 1.94, 7.75), (.055, 1.32, .05), m["mint"], root, .009)
    # A usable ramp slopes to the ground. Its treads and safety edges read at scale.
    panel("Cargo loading ramp", [(-1.42, 1.08, 7.48), (1.42, 1.08, 7.48),
          (1.75, .22, 11.23), (-1.75, .22, 11.23)], .17, m["steel"], root, .045)
    for side in (-1, 1):
        beam("Ramp outer rail", (side * 1.43, 1.20, 7.51), (side * 1.72, .36, 11.18), .10, m["ivory"], root)
        beam("Ramp cyan guide", (side * 1.24, 1.115, 7.66), (side * 1.47, .295, 11.02), .048, m["mint"], root)
    for i in range(14):
        t = i / 13
        z = 7.7 + t * 3.25
        y = 1.08 - (z - 7.48) / 3.75 * .86 + .034
        box("Ramp non-slip tread", (0, y, z), (2.5 + t * .38, .055, .07), m["graphite"], root, .008)
    empty("loading_socket", (0, .22, 11.30), root)

    # Attached service platform, utility crates, aerial and articulated task lights.
    box("Starboard service platform", (4.22, 1.20, 1.82), (1.78, .25, 4.8), m["graphite"], root, .05)
    for z in (-.25, 3.94):
        beam("Platform orange edge", (3.4, 1.36, z), (5.04, 1.36, z), .08, m["orange"], root)
    for z in (-.1, .35, .8, 1.25, 1.7, 2.15, 2.6, 3.05, 3.5):
        box("Platform slat", (4.22, 1.35, z), (1.59, .07, .13), m["steel"], root, .012)
    crate("Deck utility case", (4.18, 1.87, 3.0), (1.17, .89, 1.08), m, root, orange=False)
    crate("Ground cargo case", (-4.62, .66, 7.88), (1.8, 1.12, 1.8), m, root)
    for side in (-1, 1):
        beam("ATLAS worklamp mast", (side * 3.11, 3.6, 4.62), (side * 3.35, 5.10, 4.62), .11, m["steel"], root)
        beam("ATLAS worklamp arm", (side * 3.35, 5.10, 4.62), (side * 4.15, 5.10, 4.62), .11, m["graphite"], root)
        box("ATLAS task light housing", (side * 4.14, 5.08, 4.66), (.55, .25, .48), m["graphite"], root)
        box("ATLAS task light", (side * 4.14, 4.941, 4.67), (.38, .025, .29), m["amber"], root, .016)
        empty("worklight_left" if side == -1 else "worklight_right", (side * 4.14, 4.88, 4.67), root)
    cylinder("ATLAS antenna mount", (1.69, 4.26, -3.6), .26, .32, m["orange"], root)
    beam("ATLAS communications aerial", (1.69, 4.35, -3.6), (1.69, 6.30, -3.6), .075, m["steel"], root)
    beam("ATLAS aerial crosspiece", (1.2, 5.94, -3.6), (2.2, 5.94, -3.6), .07, m["graphite"], root)
    cylinder("ATLAS aerial locator", (1.69, 6.34, -3.6), .09, .12, m["mint"], root, sides=12)
    fasteners([(side * 2.89, 4.135, z) for side in (-1, 1) for z in (-6.3, -5.8)], m["graphite"], root, .07)
    export_asset("atlas", root, 25.4, (20, 27, -28))


def merge_by_material(root):
    # Static parts share one draw call for each material and articulated parent.
    groups = {}
    for obj in list(root.children_recursive):
        if obj.type == "MESH":
            key = (obj.parent.name, obj.data.materials[0].name)
            groups.setdefault(key, []).append(obj)
    for (parent_name, material_name), objects in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = f"{parent_name}__{material_name.split(' | ')[-1].replace(' ', '_')}"
    bpy.ops.object.select_all(action="DESELECT")


def export_asset(name, root, camera_scale, camera_position):
    merge_by_material(root)
    bpy.context.view_layer.update()
    vertices = [obj.matrix_world @ v.co for obj in root.children_recursive if obj.type == "MESH" for v in obj.data.vertices]
    game = [(v.x, v.z, -v.y) for v in vertices]
    bounds = {"min": [round(min(v[i] for v in game), 4) for i in range(3)],
              "max": [round(max(v[i] for v in game), 4) for i in range(3)]}
    bounds["size"] = [round(bounds["max"][i] - bounds["min"][i], 4) for i in range(3)]
    meshes = [obj for obj in root.children_recursive if obj.type == "MESH"]
    report = {
        "name": name, "units": "meters", "up": "+Y", "forward": "-Z", "bounds": bounds,
        "mesh_count": len(meshes), "material_count": len({obj.data.materials[0].name for obj in meshes}),
        "triangle_count": sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons) for obj in meshes),
        "sockets": {obj.name: [round(n, 4) for n in (obj.location.x, obj.location.z, -obj.location.y)]
                    for obj in root.children_recursive if obj.type == "EMPTY"},
        "socket_positions_are": "local to parent; laser_socket is relative to mining_turret",
    }
    (OUTPUT / f"{name}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    for obj in [root] + list(root.children_recursive):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / f"{name}.glb"), export_format="GLB",
                              use_selection=True, export_yup=True, export_apply=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_extras=True, export_materials="EXPORT")
    studio(root, name, camera_scale, camera_position, bounds)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / f"{name}.blend"))
    bpy.context.scene.render.filepath = str(PREVIEWS / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("ASSET_REPORT " + json.dumps(report), flush=True)


def studio(root, name, camera_scale, camera_position, bounds):
    scene = bpy.context.scene
    bpy.context.preferences.filepaths.save_version = 0
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1050
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (.075, .075, .075)
    world = bpy.data.worlds.new("Charcoal studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (.11, .15, .19, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = .55
    scene.world = world
    groundmat = material("studio floor (not exported)", (.049, .069, .083), .1, .66)
    ground = box("Studio plinth (not exported)", (0, bounds["min"][1] - .10, 0), (200, .15, 200), groundmat, None, 0)
    for light_name, loc, color, energy, size in [
        ("Warm key", (-camera_scale * .7, camera_scale * 1.4, -camera_scale * .5), (1, .89, .71), 1900 * (camera_scale / 10) ** 2, camera_scale * .7),
        ("Cool softbox", (camera_scale * .9, camera_scale * .7, 0), (.67, .83, 1), 1200 * (camera_scale / 10) ** 2, camera_scale * .8),
        ("Rim softbox", (0, camera_scale * .8, camera_scale * .9), (.80, .96, 1), 1750 * (camera_scale / 10) ** 2, camera_scale * .65),
    ]:
        data = bpy.data.lights.new(light_name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(light_name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = position(loc)
        obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()
    data = bpy.data.cameras.new("Asset inspection camera")
    data.type = "ORTHO"
    data.ortho_scale = camera_scale
    camera = bpy.data.objects.new("Asset inspection camera", data)
    bpy.context.collection.objects.link(camera)
    camera.location = position(camera_position)
    target = Vector(position((0, (bounds["min"][1] + bounds["max"][1]) * .32, .1)))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    scene.view_settings.view_transform = "AgX"
    # Keep only the asset hierarchy selected on opening the source project.
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    bpy.context.view_layer.objects.active = root


if __name__ == "__main__":
    names = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["speeder", "atlas"]
    for name in names:
        {"speeder": speeder, "atlas": atlas}[name]()
