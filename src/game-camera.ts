import * as THREE from 'three';
export const GAME_CAMERA_OFFSET=new THREE.Vector3(0,165,120);
export const gameViewAngles=()=>({yaw:Math.PI/2,pitch:Math.atan2(GAME_CAMERA_OFFSET.y,GAME_CAMERA_OFFSET.z)});
/** The regular game angle, independent of the workshop and arrival animation. */
export function gameCameraQuaternion(){const c=new THREE.PerspectiveCamera();c.position.copy(GAME_CAMERA_OFFSET);c.up.set(0,0,-1);c.lookAt(0,0,0);return c.quaternion.clone();}
