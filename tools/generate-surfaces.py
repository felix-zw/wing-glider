"""Deterministic, seamless original PBR surface maps. Requires numpy and Pillow.

Run before tools/encode-surfaces.mjs. Source math is the editable source asset;
no external images, copyrighted textures or network access are involved.
"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'art' / 'surfaces'
OUT.mkdir(parents=True, exist_ok=True)
N = 1024
y, x = np.mgrid[0:N, 0:N].astype(float) / N
rng = np.random.default_rng(24097113)

def noise(octaves=7):
    out = np.zeros((N,N))
    weight=0
    for octave in range(octaves):
        f = 4 * 2 ** octave
        grid=rng.random((f,f))*2-1
        ix=np.floor(x*f).astype(int); iy=np.floor(y*f).astype(int)
        u=x*f-ix;v=y*f-iy
        u=u*u*(3-2*u);v=v*v*(3-2*v)
        value=(grid[iy%f,ix%f]*(1-u)+grid[iy%f,(ix+1)%f]*u)*(1-v)+(grid[(iy+1)%f,ix%f]*(1-u)+grid[(iy+1)%f,(ix+1)%f]*u)*v
        amplitude=.55**octave
        out+=value*amplitude;weight+=amplitude
    return out/weight

def save(name, a):
    Image.fromarray(np.clip(a*255,0,255).astype('uint8')).save(OUT / f'{name}.png')

def normal(h, strength):
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))*strength
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))*strength
    n=np.stack((-dx,dy,np.ones_like(h)),axis=2)
    n/=np.linalg.norm(n,axis=2,keepdims=True)
    return n*.5+.5

n=noise()
warp=.32*np.sin(x*6.28)+.13*np.sin(x*18.85+y*12.566)
ripple=(.5+.5*np.sin(y*6.28318530718*11+warp*6.28318530718))**3
grains=rng.random((N,N))
sand=.1*n+.07*ripple+.005*grains
sand_rgb=np.array([.62,.59,.48])[None,None,:]*(1+(.11*n+.025*ripple+.025*(grains-.5))[:,:,None])
save('sand-color',sand_rgb)
save('sand-normal',normal(sand,4))
save('sand-orm',np.stack((.94+.06*ripple,.88+.08*grains,np.zeros_like(x)),axis=2))

n=noise()
strata=np.sin(y*6.28318530718*17+.23*np.sin(x*12.56637061436)+n*.5)
fissure=np.exp(-np.abs(np.sin(x*6.28318530718*5+n*3))*50)
rock=n*.65+strata*.025-fissure*.04
rock_rgb=np.array([.63,.59,.51])[None,None,:]*(1+(.48*n+.055*strata-.15*fissure)[:,:,None])
save('rock-color',rock_rgb)
save('rock-normal',normal(rock,10))
save('rock-orm',np.stack((.9-.16*fissure,.78+.1*grains,np.ones_like(x)*.04),axis=2))
print(f'Wrote six 1024px seamless PBR maps to {OUT}')
