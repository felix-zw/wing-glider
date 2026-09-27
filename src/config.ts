export const CONFIG = {
  seed: 2409, worldHalf: 210, maxSpeed: 38, acceleration: 17,
  drag: 3.2, braking: 42, turnRate: 1.9, hoverHeight: 2.4,
  calmSeconds: 45, warningSeconds: 12, stormSeconds: 15,
  maxHealth: 100, stormDamage: 10, shelterRadius: 12, deadzone: 0.16,
} as const;

export const RESOURCE_CONFIG = {
  capacity: 30, laserRange: 22, aimAssist: 12 * Math.PI / 180,
  magnetRadius: 10, pickupRadius: 2, magnetSpeed: 12, ejectSeconds: 0.35,
  ejectSpeed: 6, depositsPerType: 6, unitsPerDeposit: 12,
  depositSpacing: 22, shelterClearance: 23, boundaryMargin: 18,
} as const;

export const TRANSPORTER = { x: 0, z: 0, radius: 8, maxUnloadSpeed: 2, name: 'ATLAS' } as const;

export const COLLISION = { shipRadius: 2.5, damageThreshold: 6, damageScale: 1.5, maxDamage: 25, cooldown: 0.8 } as const;
export const SPACE = { hazardCount: 12, minSpeed: 6, maxSpeed: 12, shieldRadius: 22, flightHeight: 2.4 } as const;
