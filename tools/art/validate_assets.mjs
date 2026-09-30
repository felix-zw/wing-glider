/** Validate the shipped GLBs with the same Three.js loader used by the game. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const directory = new URL('../../public/assets/models/', import.meta.url);
const expected = {
  speeder: { maxMeshes: 35, nodes: ['mining_turret', 'laser_socket', 'exhaust_left', 'exhaust_right', 'reverse_left', 'reverse_right', 'side_left_front', 'side_left_aft', 'side_right_front', 'side_right_aft', 'cargo_socket'] },
  atlas: { maxMeshes: 70, nodes: ['loading_socket', 'worklight_left', 'worklight_right', 'bay_socket', 'exit_socket', 'hangar_door', 'ramp_hinge',
    ...Array.from({length:4},(_,i)=>'ramp_section_'+i),
    ...['left_front','left_aft','right_front','right_aft'].flatMap(id=>['hip','upper','knee','lower','piston','foot','lift'].map(part=>part+'_'+id)),
    'cruise_left','cruise_right','brake_left','brake_right'] },
};

for (const [name, config] of Object.entries(expected)) {
  const path = new URL(`${name}.glb`, directory);
  const buffer = await readFile(path);
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', `${name}: GLB header`);
  const content = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const gltf = await new GLTFLoader().parseAsync(content, fileURLToPath(directory));
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  let meshes = 0;
  let triangles = 0;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    meshes++;
    const geometry = node.geometry;
    assert.ok(geometry.attributes.normal, `${name}: mesh has normals`);
    for (const value of geometry.attributes.position.array) {
      assert.ok(Number.isFinite(value), `${name}: finite position`);
    }
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  });
  assert.ok(meshes > 0 && meshes <= config.maxMeshes, `${name}: draw-call budget`);
  assert.equal(triangles % 1, 0, `${name}: triangle list`);
  for (const nodeName of config.nodes) {
    assert.ok(scene.getObjectByName(nodeName), `${name}: required attachment ${nodeName}`);
  }
  const bounds = new Box3().setFromObject(scene, true);
  const manifest = JSON.parse(await readFile(new URL(`${name}.json`, directory), 'utf8'));
  for (const [label, actual] of [['min', bounds.min], ['max', bounds.max]]) {
    actual.toArray().forEach((value, index) => {
      assert.ok(Math.abs(value - manifest.bounds[label][index]) < .001, `${name}: manifest ${label} matches GLB`);
    });
  }
  if (name === 'speeder') {
    const turret = scene.getObjectByName('mining_turret');
    const socket = scene.getObjectByName('laser_socket');
    assert.equal(socket.parent, turret, 'laser socket follows the independent turret');
    const forward = new Vector3(0, 0, -1).transformDirection(turret.matrixWorld);
    assert.ok(forward.z < -.999, 'turret local forward is game -Z');
    const before = socket.getWorldPosition(new Vector3());
    turret.rotation.y = Math.PI / 2;
    scene.updateMatrixWorld(true);
    const after = socket.getWorldPosition(new Vector3());
    assert.ok(Math.abs(before.y - after.y) < .001, 'turret rotates around game Y');
    assert.ok(after.distanceTo(before) > 1, 'laser socket moves with turret rotation');
  }
  if(name==='atlas') {
    const ramp=scene.getObjectByName('ramp_hinge'),door=scene.getObjectByName('hangar_door'),bay=scene.getObjectByName('bay_socket');
    const socket=scene.getObjectByName('loading_socket'),before=socket.getWorldPosition(new Vector3()),bayBefore=bay.getWorldPosition(new Vector3());
    ramp.rotation.x=.25;scene.updateMatrixWorld(true);
    assert.ok(socket.getWorldPosition(new Vector3()).distanceTo(before)>3,'loading socket follows the independent ramp');
    assert.ok(bay.getWorldPosition(new Vector3()).distanceTo(bayBefore)<.001,'moving ramp leaves the bay fixed');
    assert.equal(socket.parent.name,'ramp_section_3');
    door.position.y+=5.1;scene.updateMatrixWorld(true);
    assert.ok(new Box3().setFromObject(door).min.y>5,'open door clears the complete speeder');
    assert.ok(triangles<50000,'articulated ATLAS triangle budget');
  }
  console.log(`${name}: ${meshes} meshes, ${triangles} triangles, ${(buffer.length / 1024).toFixed(0)} KiB; transforms and sockets verified`);
}
