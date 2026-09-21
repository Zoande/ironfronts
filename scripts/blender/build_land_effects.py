"""Author a deterministic smoke/fire flipbook from expanding volumetric lobes.
No source photographs or third-party texture inputs. Run in Blender background.
"""
import bpy
import numpy as np
from pathlib import Path

root=Path(__file__).resolve().parents[2]
size=256
y,x=np.mgrid[-1:1:complex(size),-1:1:complex(size)].astype(np.float32)
rng=np.random.default_rng(781)
lobes=[(rng.uniform(-.5,.5),rng.uniform(-.4,.4),rng.uniform(.15,.32),rng.uniform(.6,1.4)) for _ in range(22)]
atlas=np.zeros((size*8,size*4,4),dtype=np.float32)
for frame in range(16):
    age=frame/15
    density=np.zeros((size,size),dtype=np.float32)
    for cx,cy,radius,weight in lobes:
        spread=.4+age*.8
        px=cx*spread+np.sin(age*4+cy*7)*.06
        py=cy*spread+age*.09
        r=radius*(.65+age*.7)
        dist=((x-px)**2+(y-py)**2)/(r*r)
        density+=np.maximum(0,1-dist)**1.7*weight
    turbulence=(np.sin(x*36+np.sin(y*27+age*3))*np.sin(y*41+np.sin(x*29))*.065
                +np.sin(x*77+y*48)*.024)
    density=np.maximum(0,density+turbulence*np.minimum(1,density))
    dy,dx=np.gradient(density)
    lighting=np.clip(.5-dx*3+dy*5,.12,.95)
    alpha=(1-np.exp(-density*1.8))*(1-age*.60)
    col=np.repeat(lighting[:,:,None],3,axis=2)
    smoke=np.concatenate((col,alpha[:,:,None]),axis=2)
    heat=np.clip(density*.8-age*1.45,0,1)
    fire=np.empty_like(smoke)
    fire[:,:,:3]=col*.25*(1-heat[:,:,None])+np.stack((np.ones_like(heat),.16+heat*.74,.025+heat**3*.6),axis=2)*heat[:,:,None]
    fire[:,:,3]=alpha
    row,column=divmod(frame,4)
    # Image pixels are bottom-up in Blender; shader frame rows are top-down.
    for bank,pixels in [(0,smoke),(1,fire)]:
        bottom=(7-(row+bank*4))*size
        atlas[bottom:bottom+size,column*size:(column+1)*size]=pixels[::-1]
image=bpy.data.images.new('Ironfronts original smoke and fire',width=size*4,height=size*8,alpha=True)
image.colorspace_settings.name='Non-Color'
image.pixels.foreach_set(atlas.ravel())
image.filepath_raw=str(root/'public/models/land/land-effects.png')
image.file_format='PNG';image.save()
print('Authored 32 effect frames:',image.filepath_raw)
