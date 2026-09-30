"""Bake reusable PBR maps from the original generated basalt surface.

The source image stays unchanged. Height and roughness are artistic luminance
estimates, not measured photogrammetry. Rebuild with numpy and Pillow.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'art'/'surfaces'
source=Image.open(OUT/'stone-fracture-source.png').convert('RGB').resize((1024,1024),Image.Resampling.LANCZOS)
color=np.asarray(source,dtype=float)/255
lum=color@np.array([.2126,.7152,.0722])
height=np.asarray(source.convert('L').filter(ImageFilter.GaussianBlur(2.5)),dtype=float)/255
height=np.clip((height-.09)*1.9,0,1)
dx=(np.roll(height,-1,1)-np.roll(height,1,1))*24
dy=(np.roll(height,-1,0)-np.roll(height,1,0))*24
normal=np.stack([-dx,-dy,np.ones_like(height)],axis=-1)
normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
orm=np.stack([np.clip(.54+lum*1.8,0,1),np.clip(.94-lum*.28,.65,.97),height],axis=-1)
for name,data in [('color',color),('normal',normal*.5+.5),('orm',orm)]:
    Image.fromarray(np.uint8(np.clip(data*255,0,255))).save(OUT/f'stone-{name}.png')
print('Baked shared basalt colour, normal, occlusion, roughness and height.')
