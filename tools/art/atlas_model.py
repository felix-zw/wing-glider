"""ATLAS-07 articulated expedition tender. All coordinates are game metres."""
import math
from mathutils import Vector
from build_assets import (reset, palette, empty, box, loft, cylinder, beam, label,
                          crate, fasteners, export_asset, position)


def build_atlas():
    reset()
    m = palette()
    root = empty('atlas')
    root['asset_version'] = 2
    root['forward'] = '-Z'
    root['description'] = 'ATLAS-07 | Articulated expedition tender / clear vehicle hangar'
    # Real hollow bay: neither a solid hull nor a painted black doorway.
    box('Hangar structural floor', (0, -.34, 1), (8.5, .62, 18), m['graphite'], root, .10)
    box('Hangar wear plate', (0, -.035, 1), (8.1, .07, 17.8), m['steel'], root, .015)
    for side in (-1, 1):
        box('Hangar inner wall', (side*4.45, 2.6, 1), (.65, 5.2, 18), m['graphite'], root, .09)
        for z in (-6, -2, 2, 6):
            box('Bay frame rib', (side*4.06, 2.5, z), (.20, 5, .22), m['steel'], root, .025)
            box('Bay amber strip', (side*3.95, .4, z), (.08, .12, 2.4), m['amber'], root, .01)
        loft('Armored side nacelle', [(-11, .7, -.5, 2.8), (-8, 1.4, -.5, 4.6),
             (6.6, 1.4, -.5, 4.4), (9.5, 1.0, -.45, 3.4)], m['ivory'], root, x=side*6.15, bevel=.14)
        for z in (-6.4, -2.5, 1.4, 5.3):
            box('Armored removable panel', (side*6.13, 4.5, z), (1.6, .12, 3.05), m['chalk'], root, .09)
            box('Panel orange end', (side*6.13, 4.57, z+1.15), (1.6, .05, .30), m['orange'], root, .02)
            box('Hull side cooling gap', (side*7.53, 2.2, z), (.06, 1.3, 2.4), m['rubber'], root)
            for offset in (-.8, -.4, 0, .4, .8):
                box('Vent fin', (side*7.57, 2.2, z+offset), (.09, 1.15, .07), m['steel'], root, .012)
        for index, z in enumerate((-8, 6)):
            leg_id = ('left' if side < 0 else 'right') + ('_front' if index == 0 else '_aft')
            # Root-space articulated nodes. Runtime solves each linkage independently.
            hip = (side*6, 1, z)
            knee = (side*9.12, .29, z)
            ankle = (side*9.5, -3.5, z)
            cylinder('Orange shoulder bearing', hip, .5, .75, m['orange'], root, axis='z', sides=16)
            empty('hip_'+leg_id, hip, root)
            def segment(node_name, start, end, width, material):
                node = empty(node_name, start, root)
                box('Link sleeve', (0, .5, 0), (width, 1, width*.85), material, node, .05)
                a, b = Vector(position(start)), Vector(position(end))
                node.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
                node.scale.z = (b-a).length
                return node
            segment('upper_'+leg_id, hip, knee, .60, m['graphite'])
            segment('lower_'+leg_id, knee, ankle, .43, m['ivory'])
            piston = segment('piston_'+leg_id, knee, ankle, .18, m['steel'])
            # The piston is offset just enough to be readable beside its sleeve.
            piston.location.y -= .34
            kn = empty('knee_'+leg_id, knee, root)
            cylinder('Knee joint', (0, 0, 0), .43, .7, m['orange'], kn, axis='z', sides=16)
            foot = empty('foot_'+leg_id, ankle, root)
            box('Broad landing sole', (0, .12, 0), (2.1, .24, 2.7), m['graphite'], foot, .09)
            box('Raised pad plate', (0, .30, 0), (1.5, .18, 1.9), m['steel'], foot, .06)
            cylinder('Ankle ball', (0, .5, 0), .29, .40, m['orange'], foot, sides=12)
            for dz in (-1.05, 1.05):
                box('Pad warning stripe', (0, .245, dz), (1.4, .025, .16), m['orange'], foot, .01)
        for index, z in enumerate((-5.5, 5.5)):
            x=side*6.65
            cylinder('Lift turbine housing', (x, .24, z), .86, 1.2, m['graphite'], root, sides=20, radius2=1.05)
            cylinder('Lift nozzle lip', (x, -.48, z), .92, .20, m['steel'], root, sides=20)
            cylinder('Lift ion core', (x, -.59, z), .66, .03, m['mint'], root, sides=20)
            empty('lift_'+('left' if side<0 else 'right')+('_front' if index==0 else '_aft'), (x, -.62, z), root)
        cylinder('Aft cruise turbine', (side*6, 2, 9.3), 1.0, 1.3, m['graphite'], root, axis='z', sides=20)
        cylinder('Aft cruise core', (side*6, 2, 9.98), .65, .04, m['mint'], root, axis='z', sides=20)
        empty('cruise_'+('left' if side<0 else 'right'), (side*6, 2, 10.02), root)
        cylinder('Reverse nozzle', (side*6, 1.7, -10), .45, .35, m['graphite'], root, axis='z', sides=16)
        empty('brake_'+('left' if side<0 else 'right'), (side*6, 1.7, -10.2), root)

    box('Hangar ceiling', (0, 5.45, 1), (9.1, .5, 18), m['ivory'], root, .12)
    box('Hangar forward bulkhead', (0, 2.5, -8.1), (8.6, 5.5, .3), m['graphite'], root)
    for z in (-5, 0, 5):
        box('Roof armored spine', (0, 5.77, z), (3.2, .22, 4.3), m['chalk'], root, .09)
        for side in (-1, 1):
            crate('Secured expedition cassette', (side*3, 6.08, z), (1.55, .85, 2.9), m, root)
    loft('Bridge forward pressure hull', [(-14, 1.7, -.45, 2.2), (-12, 4.4, -.55, 4.8),
         (-8.2, 4.4, -.55, 5.7)], m['ivory'], root, bevel=.13)
    loft('Bridge wraparound gasket', [(-13, 2.15, 2.6, 3.45), (-10.8, 3.7, 3.5, 4.6),
         (-9.0, 3.75, 3.6, 4.8)], m['graphite'], root, bevel=.06)
    loft('Bridge polarized glass', [(-12.85, 2.08, 2.76, 3.44), (-10.8, 3.57, 3.67, 4.61),
         (-9.1, 3.59, 3.77, 4.78)], m['glass'], root, bevel=.035)
    box('Bridge crown', (0, 5.2, -9.4), (5.4, .25, 1.5), m['chalk'], root, .12)
    label('ATLAS roof identity', 'ATLAS', (0, 5.905, .8), .94, m['graphite'], root)
    label('ATLAS roof registry', '07 / EXPEDITION', (0, 5.905, 2), .26, m['graphite'], root)
    for side in (-1, 1):
        box('Portal jamb', (side*4.45, 2.65, 10), (.55, 5.3, .6), m['ivory'], root, .08)
        box('Portal guide lamp', (side*4.12, 2.65, 10.34), (.10, 4.6, .04), m['mint'], root, .008)
        empty('worklight_left' if side<0 else 'worklight_right', (side*4.4, 5.3, 10.4), root)
    box('Portal lintel', (0, 5.3, 10), (9.4, .45, .65), m['graphite'], root, .08)
    door = empty('hangar_door', (0, 0, 10.12), root)
    for i in range(8):
        box('Door armored slat', (0, .35+i*.60, 0), (8.12, .57, .18), m['ivory'], door, .035)
        box('Door inset', (0, .35+i*.60, .103), (5.6, .09, .035), m['graphite'], door, .005)
    box('Door orange identification', (0, 2.5, .14), (1.2, 4.3, .035), m['orange'], door, .01)
    ramp = empty('ramp_hinge', (0, 0, 10.40), root)
    # Four nesting sections extend from a five metre folded loading platform.
    for index in range(4):
        section = empty('ramp_section_'+str(index), (0, -index*.035, 0), ramp)
        width=8.2-index*.12
        box('Ramp tread plate', (0, -.06, 2.5), (width, .12, 5), m['steel'], section, .025)
        for side in (-1,1):
            box('Ramp safety curb', (side*(width/2-.08), .05, 2.5), (.16, .22, 5), m['graphite'], section, .025)
            box('Ramp illuminated guide', (side*(width/2-.3), .015, 2.5), (.07, .04, 4.8), m['mint'], section, .008)
        for i in range(9):
            box('Ramp grip crossbar', (0, .018, .25+i*.55), (width-.8, .035, .09), m['graphite'], section, .008)
    ramp.rotation_euler.x = -math.pi/2
    # Sockets are machine-readable spatial contracts, not cosmetic markers.
    empty('bay_socket', (0, 1.35, 1), root)
    empty('exit_socket', (0, 1.35, 10), root)
    empty('loading_socket', (0, 0, 5), section)
    beam('Communications mast', (2.1, 5.7, -7.3), (2.1, 8.1, -7.3), .11, m['steel'], root)
    cylinder('Navigation beacon', (2.1, 8.15, -7.3), .16, .22, m['mint'], root, sides=12)
    fasteners([(side*4.4, 5.56, z) for side in (-1,1) for z in (-7,-3,1,5,9)], m['graphite'], root, .08)
    export_asset('atlas', root, 39, (30, 30, 40))
