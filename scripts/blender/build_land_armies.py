"""Original Ironfronts land assets. Run with Blender --background --python this_file.

All geometry, rigs, motion and texture pixels are authored here; no imported art.
Z up, -Y forward in Blender; glTF exports Y up, +Z forward. Metres throughout.
"""
import bpy
import math
import json
import sys
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/land'
SOURCE = ROOT / 'material/land-armies'
PREVIEW = ROOT / 'artifacts/land-armies'
for directory in (OUT, SOURCE, PREVIEW):
    directory.mkdir(parents=True, exist_ok=True)

bpy.context.preferences.filepaths.save_version = 0

PARTS = []
DETAILS = []
MAT = None
# Atlas swatches: wool, webbing, leather, skin, gun steel, wood, paint,
# rubber, dark metal, brass, glass, markings, pale canvas, mud, seam, team patch.
COLORS = [(0.29, .31, .23), (.43,.40,.28), (.19,.12,.075), (.59,.39,.28),
          (.16,.18,.18), (.29,.14,.065), (.26,.30,.23), (.075,.078,.075),
          (.105,.12,.115), (.50,.38,.15), (.12,.19,.21), (.72,.70,.59),
          (.49,.46,.35), (.22,.18,.13), (.21,.23,.17), (.62,.62,.57)]

def textures():
    rng = np.random.default_rng(1941)
    size, tile = 2048, 512
    base = np.ones((size,size,4), dtype=np.float32)
    orm = np.ones_like(base)
    normal = np.ones_like(base)
    yy, xx = np.mgrid[0:tile,0:tile].astype(np.float32)
    for i,c in enumerate(COLORS):
        y,x = divmod(i,4)
        noise = rng.normal(0,1,(tile,tile)).astype(np.float32)
        broad = np.sin(xx*.047 + np.sin(yy*.029))*np.cos(yy*.039)*.018
        weave = (np.sin(xx*math.pi*.5)*np.sin(yy*math.pi*.5))*.018
        detail = noise*.013 + broad
        if i in (0,1,12,14): detail += weave
        if i==5: detail += np.sin(xx*.12 + np.sin(yy*.018)*2)*.025
        if i in (4,6,8):
            # Fine directional scratches, sparse worn paint. No baked illumination.
            scratch = (np.sin(xx*.82 + np.sin(yy*.011)*1.8)>.996) & (noise>.35)
            detail += scratch*.11
        region = np.s_[y*tile:(y+1)*tile,x*tile:(x+1)*tile]
        base[region][:,:,:3] = np.clip(np.array(c)[None,None,:]+detail[:,:,None],.015,.95)
        base[region][:,:,3] = 1
        rough = .89 if i in (0,1,7,12,13,14) else .58 if i in (2,3,5,6) else .35
        orm[region][:,:,0] = 1
        orm[region][:,:,1] = np.clip(rough+noise*.025,.1,1)
        orm[region][:,:,2] = .82 if i in (4,8,9) else 0
        dx,dy = np.gradient(detail)
        normal[region][:,:,0] = .5-dy*.55
        normal[region][:,:,1] = .5-dx*.55
        normal[region][:,:,2] = 1
    images=[]
    for name,pixels in [('basecolor',base),('orm',orm),('normal',normal)]:
        image=bpy.data.images.new('Land shared '+name,width=size,height=size,alpha=True)
        image.colorspace_settings.name = 'sRGB' if name=='basecolor' else 'Non-Color'
        image.pixels.foreach_set(pixels.ravel())
        image.filepath_raw=str(OUT/('land-'+name+'.png'))
        image.file_format='PNG'
        image.save()
        images.append(image)
    mat=bpy.data.materials.new('Ironfronts original shared materials')
    mat.use_nodes=True
    nodes=mat.node_tree.nodes; links=mat.node_tree.links
    bsdf=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage');tex.image=images[0]
    links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
    packed=nodes.new('ShaderNodeTexImage');packed.image=images[1]
    separate=nodes.new('ShaderNodeSeparateColor');links.new(packed.outputs['Color'],separate.inputs[0])
    links.new(separate.outputs['Green'],bsdf.inputs['Roughness'])
    links.new(separate.outputs['Blue'],bsdf.inputs['Metallic'])
    ntex=nodes.new('ShaderNodeTexImage');ntex.image=images[2]
    nmap=nodes.new('ShaderNodeNormalMap');links.new(ntex.outputs['Color'],nmap.inputs['Color'])
    links.new(nmap.outputs[0],bsdf.inputs['Normal'])
    return mat

def finish(obj,name,tile,bone='Root',detail=False):
    obj.name=name
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if not obj.data.uv_layers:
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(island_margin=.025);bpy.ops.object.mode_set(mode='OBJECT')
    for loop in obj.data.uv_layers.active.data:
        u,v=loop.uv
        loop.uv=((tile%4 + .025+u*.95)/4,(tile//4+.025+v*.95)/4)
    obj.data.materials.clear();obj.data.materials.append(MAT)
    group=obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    PARTS.append(obj)
    if detail: DETAILS.append(obj)
    return obj

def ellipsoid(name,pos,scale,tile,bone='Root',segments=24,rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=pos)
    obj=bpy.context.object;obj.scale=scale
    for p in obj.data.polygons:p.use_smooth=True
    return finish(obj,name,tile,bone)

def box(name,pos,size,tile,bone='Root',bevel=.018):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos)
    obj=bpy.context.object;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=obj.modifiers.new('Machined or sewn edges','BEVEL');mod.width=bevel;mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=obj.modifiers.new('Weighted face normals','WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj,name,tile,bone)

def cylinder(name,a,b,radius,tile,bone='Root',vertices=20,r2=None):
    a,b=Vector(a),Vector(b);delta=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=radius if r2 is None else r2,depth=delta.length,location=(a+b)/2)
    obj=bpy.context.object;obj.rotation_euler=delta.to_track_quat('Z','Y').to_euler()
    for p in obj.data.polygons:p.use_smooth=len(p.vertices)==4
    return finish(obj,name,tile,bone)

def strap(name,points,width,depth,tile,bone):
    for i,(a,b) in enumerate(zip(points,points[1:])):
        a,b=Vector(a),Vector(b)
        obj=box(name+str(i),(a+b)/2,(width,depth,(b-a).length+.006),tile,bone,bevel=.003)
        obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()

def loft(name,rings,tile,bone,segments=24):
    # Anatomical / tailored cross sections, including small irregular cloth folds.
    vertices=[];faces=[]
    for j,(x,y,z,rx,ry) in enumerate(rings):
        for i in range(segments):
            a=2*math.pi*i/segments
            fold=1+(.012*math.sin(a*5+j*1.9)+.007*math.cos(a*9-j) if tile==0 else 0)
            vertices.append((x+math.cos(a)*rx*fold,y+math.sin(a)*ry*fold,z))
    for j in range(len(rings)-1):
        for i in range(segments):
            k=j*segments+i;n=j*segments+(i+1)%segments
            faces.append((k,n,n+segments,k+segments))
    faces += [tuple(reversed(range(segments))),tuple(range((len(rings)-1)*segments,len(rings)*segments))]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    uv=mesh.uv_layers.new()
    for polygon in mesh.polygons:
        polygon.use_smooth=True
        ids=[mesh.loops[k].vertex_index%segments for k in polygon.loop_indices]
        wrap=0 in ids and segments-1 in ids
        for k in polygon.loop_indices:
            index=mesh.loops[k].vertex_index
            u=(index%segments)/segments
            if wrap and index%segments==0:u=1
            uv.data[k].uv=(u,(index//segments)/(len(rings)-1))
    return finish(obj,name,tile,bone)

def limb(name,a,b,radii,tile,bone):
    a,b=Vector(a),Vector(b)
    # Loft locally vertical then align to the limb centreline.
    obj=loft(name,[(0,0,(b-a).length*t,r,r*.90) for t,r in radii],tile,bone,20)
    obj.location=a;obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return obj

def rig(bones):
    bpy.ops.object.armature_add()
    arm=bpy.context.object;arm.name='Ironfronts_Rig'
    bpy.ops.object.mode_set(mode='EDIT')
    arm.data.edit_bones.remove(arm.data.edit_bones[0])
    for name,head,tail,parent in bones:
        b=arm.data.edit_bones.new(name);b.head=head;b.tail=tail
        if parent:b.parent=arm.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in arm.pose.bones:p.rotation_mode='XYZ'
    return arm

def infantry():
    bones=[('Root',(0,0,0),(0,0,.2),None),('Pelvis',(0,0,.89),(0,0,1.03),'Root'),
           ('Chest',(0,0,1.03),(0,0,1.43),'Pelvis'),('Head',(0,0,1.46),(0,0,1.70),'Chest')]
    for side,s in [('L',1),('R',-1)]:
        hip=(s*.10,0,.91);knee=(s*.105,-.022,.51);ankle=(s*.105,0,.135)
        shoulder=(s*.195,0,1.405);elbow=(s*.275,-.06,1.14);wrist=(s*.24,-.22,.97)
        bones += [(side+'Thigh',hip,knee,'Pelvis'),(side+'Shin',knee,ankle,side+'Thigh'),
                  (side+'Foot',ankle,(s*.105,-.16,.09),side+'Shin'),
                  (side+'Arm',shoulder,elbow,'Chest'),(side+'Forearm',elbow,wrist,side+'Arm'),
                  (side+'Hand',wrist,(s*.23,-.26,.91),side+'Forearm')]
        limb(side+' trouser thigh',hip,knee,[(0,.091),(.15,.10),(.38,.102),(.65,.082),(.88,.071),(1,.067)],0,side+'Thigh')
        limb(side+' trouser calf',knee,ankle,[(0,.071),(.18,.074),(.4,.077),(.65,.063),(.83,.050),(1,.047)],0,side+'Shin')
        ellipsoid(side+' knee cloth',(s*.105,-.019,.515),(.067,.059,.059),0,side+'Thigh')
        box(side+' boot sole',(s*.105,-.047,.036),(.14,.28,.04),7,side+'Foot',.018)
        ellipsoid(side+' boot vamp',(s*.105,-.065,.083),(.069,.138,.059),2,side+'Foot')
        loft(side+' boot ankle',[(s*.105,.015,.08,.06,.072),(s*.105,.01,.15,.055,.054),(s*.105,0,.245,.052,.050)],2,side+'Shin',20)
        for j in range(5):
            strap(side+' boot lace',[(s*.105-.027,-.05,.125+j*.015),(s*.105+.027,-.05,.132+j*.015)],.006,.004,1,side+'Shin')
        limb(side+' wool sleeve',shoulder,elbow,[(0,.073),(.15,.079),(.45,.073),(.8,.061),(1,.055)],0,side+'Arm')
        ellipsoid(side+' shoulder seam',(s*.18,0,1.399),(.075,.072,.073),0,side+'Arm')
        limb(side+' forearm sleeve',elbow,wrist,[(0,.057),(.2,.062),(.55,.055),(.85,.043),(1,.039)],0,side+'Forearm')
        ellipsoid(side+' palm',(s*.238,-.245,.945),(.038,.032,.052),3,side+'Hand')
        for j in range(4):
            ellipsoid(side+' finger '+str(j),(s*(.216+j*.013),-.255,.913),(.008,.014,.028),3,side+'Hand',12,8)
        ellipsoid(side+' thumb',(s*.199,-.246,.95),(.016,.019,.030),3,side+'Hand',12,8)
    loft('Tailored wool tunic',[(0,0,.84,.158,.104),(0,0,.94,.157,.106),(0,0,1.01,.144,.102),
        (0,0,1.10,.148,.105),(0,0,1.22,.184,.114),(0,0,1.34,.199,.114),(0,0,1.405,.190,.096),(0,0,1.44,.085,.072)],0,'Chest',32)
    loft('Trouser seat',[(0,0,.81,.125,.098),(0,0,.9,.157,.102),(0,0,.97,.151,.102)],0,'Pelvis',28)
    cylinder('Neck',(0,0,1.415),(0,0,1.515),.057,3,'Head')
    # Face with cheekbones, jaw, brow and nose rather than a spherical head.
    loft('Head anatomy',[(0,-.018,1.48,.036,.037),(0,-.023,1.50,.052,.049),
        (0,-.006,1.54,.066,.065),(0,.002,1.585,.076,.079),(0,.006,1.63,.074,.077),
        (0,.011,1.68,.069,.075),(0,.012,1.72,.049,.056),(0,.012,1.735,.013,.021)],3,'Head',32)
    ellipsoid('Nose bridge',(0,-.076,1.579),(.012,.019,.030),3,'Head',16,10)
    ellipsoid('Nose tip',(0,-.092,1.558),(.018,.013,.013),3,'Head',16,10)
    for s in [-1,1]:
        ellipsoid('Ear',(s*.076,.001,1.587),(.014,.023,.036),3,'Head',16,10)
        ellipsoid('Eye socket',(s*.031,-.070,1.597),(.016,.006,.006),2,'Head',16,8)
        ellipsoid('Eye',(s*.031,-.075,1.597),(.010,.002,.003),12,'Head',12,8)
        ellipsoid('Pupil',(s*.031,-.077,1.597),(.003,.0015,.003),8,'Head',12,8)
        ellipsoid('Brow',(s*.032,-.071,1.611),(.024,.009,.008),3,'Head',16,8)
        strap('Chin strap',[(s*.083,-.005,1.65),(s*.064,-.044,1.52),(s*.020,-.060,1.497)],.013,.006,2,'Head')
    box('Mouth',(0,-.069,1.524),(.034,.003,.004),2,'Head',.001)
    # Rolled helmet shell, brim and seam. A broad low steel profile, not cartoon proportions.
    loft('Steel helmet shell',[(0,.012,1.648,.099,.110),(0,.015,1.67,.096,.111),
        (0,.014,1.70,.091,.105),(0,.012,1.74,.073,.085),(0,.01,1.764,.041,.05),(0,.01,1.772,.005,.006)],6,'Head',40)
    loft('Rolled helmet rim',[(0,.012,1.642,.102,.119),(0,.012,1.649,.105,.12),(0,.012,1.655,.10,.114)],8,'Head',40)
    for s in [-1,1]:
        box('Collar',(s*.047,-.065,1.428),(.058,.037,.037),14,'Chest',.009)
        box('Breast pocket',(s*.088,-.107,1.28),(.068,.025,.095),0,'Chest',.008)
        box('Pocket flap',(s*.088,-.125,1.312),(.073,.013,.029),14,'Chest',.005)
        strap('Webbing brace',[(s*.105,-.115,1.0),(s*.155,-.112,1.32),(s*.153,0,1.44),(s*.115,.121,1.08)],.032,.012,1,'Chest')
        box('Ammunition pouch',(s*.108,-.127,1.026),(.089,.066,.096),2,'Chest',.009)
        box('Pouch lid',(s*.108,-.162,1.057),(.094,.015,.036),2,'Chest',.006)
        cylinder('Pouch stud',(s*.108,-.173,1.05),(s*.108,-.176,1.05),.006,9,'Chest',12)
    belt=loft('Waist belt',[(0,0,.989,.16,.115),(0,0,1.027,.16,.115)],2,'Chest',32)
    box('Belt buckle',(0,-.118,1.008),(.043,.012,.039),9,'Chest',.005)
    for j in range(5):cylinder('Tunic button',(0,-.113,1.10+j*.060),(0,-.119,1.10+j*.060),.0055,9,'Chest',12)
    box('Canvas field pack',(0,.146,1.236),(.244,.122,.272),1,'Chest',.03)
    box('Pack flap',(0,.211,1.333),(.251,.019,.101),12,'Chest',.014)
    for s in [-1,1]:
        strap('Pack strap',[(s*.075,.219,1.12),(s*.075,.219,1.37)],.023,.009,2,'Chest')
        box('Pack buckle',(s*.075,.227,1.23),(.033,.009,.028),9,'Chest',.004)
    cylinder('Blanket roll',(-.154,.18,1.085),(.154,.18,1.085),.062,12,'Chest',28)
    ellipsoid('Canteen',(.19,.10,1.025),(.062,.041,.078),6,'Pelvis')
    box('Canteen cap',(.19,.1,1.101),(.025,.025,.019),8,'Pelvis',.004)
    box('Faction cloth patch',(.197,-.024,1.357),(.006,.058,.048),15,'LArm',.002)
    # Weapon is independent, with an explicit muzzle joint. Posed along -Y in firing rest.
    bones += [('Weapon',(-.22,-.24,.97),(-.22,-.50,.97),'Root'),
              ('Muzzle',(-.22,-1.10,.985),(-.22,-1.16,.985),'Weapon')]
    box('Rifle walnut stock',(-.22,-.21,.96),(.048,.29,.082),5,'Weapon',.018)
    box('Rifle wooden fore-end',(-.22,-.62,.974),(.036,.53,.044),5,'Weapon',.009)
    cylinder('Rifle barrel',(-.22,-.40,.993),(-.22,-1.10,.993),.010,4,'Weapon',20)
    box('Rifle receiver',(-.22,-.38,.988),(.036,.15,.040),4,'Weapon',.006)
    cylinder('Bolt handle',(-.235,-.36,.99),(-.274,-.36,.984),.005,4,'Weapon',12)
    ellipsoid('Bolt knob',(-.277,-.36,.984),(.010,.010,.01),4,'Weapon',12,8)
    box('Front sight',(-.22,-1.055,1.011),(.014,.021,.025),8,'Weapon',.002)
    strap('Rifle sling',[(-.22,-.12,.913),(-.22,-.45,.87),(-.22,-.88,.946)],.016,.004,2,'Weapon')
    return rig(bones), {'scale':2.0,'stride':3.2,'muzzle':[-.22,.993,1.10]}

def wheel(name,x,y,z,radius,width,bone,tracked=False):
    cylinder(name+' tire',(x-width/2,y,z),(x+width/2,y,z),radius,7,bone,32)
    cylinder(name+' rim',(x-width*.53,y,z),(x+width*.53,y,z),radius*.73,6,bone,28)
    cylinder(name+' hub',(x-width*.58,y,z),(x+width*.58,y,z),radius*.26,8,bone,20)
    for k in range(8):
        a=k*math.tau/8
        for s in [-1,1]:
            cylinder(name+' lug',(x+s*width*.54,y+math.sin(a)*radius*.45,z+math.cos(a)*radius*.45),
                     (x+s*width*.58,y+math.sin(a)*radius*.45,z+math.cos(a)*radius*.45),radius*.037,4,bone,8)
    if not tracked:
        for k in range(36):
            a=k*math.tau/36
            ob=box(name+' tread',(x,y+math.sin(a)*radius,z+math.cos(a)*radius),(width*.88,.06,.026),7,bone,.005)
            ob.rotation_euler.x=-a

def vehicle(kind):
    tank=kind=='tank';car=kind=='armored-car';art=kind=='artillery'
    bones=[('Root',(0,0,0),(0,0,.3),None),('Hull',(0,0,.6),(0,0,1.0),'Root'),
           ('Turret',(0,-.2,1.45),(0,-.2,1.8),'Hull'),
           ('Gun',(0,-.5,1.65),(0,-1.0,1.65),'Turret'),
           ('Muzzle',(0,-3.3,1.65),(0,-3.5,1.65),'Gun')]
    if tank:
        box('Lower hull',(0,0,.75),(2.45,4.30,.62),6,'Hull',.10)
        box('Upper hull',(0,-.1,1.18),(2.20,3.85,.54),6,'Hull',.12)
        glacis=box('Sloping glacis',(0,-1.69,1.29),(2.19,.74,.16),6,'Hull',.025);glacis.rotation_euler.x=math.radians(32)
        box('Engine deck',(0,1.26,1.49),(1.98,1.10,.10),6,'Hull',.025)
        for i in range(13):box('Engine grille',(0,.84+i*.065,1.553),(1.22,.025,.016),8,'Hull',.003)
        cylinder('Turret ring',(0,-.35,1.43),(0,-.35,1.58),.78,8,'Hull',48)
        loft('Cast turret',[(0,-.35,1.55,.91,.87),(0,-.36,1.67,.94,.89),(0,-.29,2.13,.69,.68),(0,-.23,2.19,.54,.53)],6,'Turret',32)
        cylinder('Commander cupola',(.32,-.05,2.14),(.32,-.05,2.36),.26,6,'Turret',32)
        cylinder('Cupola lid',(.32,-.05,2.36),(.32,-.05,2.39),.28,6,'Turret',32)
        box('Mantlet',(0,-1.18,1.84),(.63,.30,.48),6,'Gun',.09)
        cylinder('Gun sleeve',(0,-1.23,1.85),(0,-1.70,1.85),.12,6,'Gun',28)
        cylinder('Gun tube',(0,-1.6,1.85),(0,-3.30,1.85),.074,4,'Gun',28,r2=.053)
        cylinder('Muzzle bore',(0,-3.303,1.85),(0,-3.31,1.85),.041,8,'Gun',24)
        for s in [-1,1]:
            box('Track guard',(s*1.30,0,1.09),(.53,4.65,.08),6,'Hull',.027)
            for j in range(6):
                y=-1.6+j*.64;bn=f'Wheel{s}_{j}'
                bones.append((bn,(s*1.23,y,.51),(s*1.45,y,.51),'Hull'))
                wheel('Road wheel',s*1.23,y,.51,.36,.23,bn,True)
            # Individually shaped links around a capsule track path.
            for k in range(64):
                t=k/64*(6.4+math.tau*.39)
                if t<3.2:y,z=-1.6+t,.10;a=0
                elif t<3.2+math.pi*.39:
                    a=(t-3.2)/.39;y=1.6+math.sin(a)*.39;z=.49-math.cos(a)*.39
                elif t<6.4+math.pi*.39:y=1.6-(t-3.2-math.pi*.39);z=.88;a=math.pi
                else:
                    a=(t-6.4-math.pi*.39)/.39+math.pi;y=-1.6+math.sin(a)*.39;z=.49-math.cos(a)*.39
                bn=f'Track{s}_{k}'
                bones.append((bn,(s*1.25,y,z),(s*1.25,y,z+.08),'Root'))
                ob=box('Track shoe',(s*1.25,y,z),(.47,.115,.060),8,bn,.007);ob.rotation_euler.x=-a
                ob=box('Track cleat',(s*1.25,y,z+.037*math.cos(a)),(.46,.027,.025),4,bn,.003);ob.rotation_euler.x=-a
            cylinder('Exhaust',(s*.8,1.94,1.0),(s*.8,2.22,1.0),.085,8,'Hull')
            for y in [-1.85,1.8]:
                cylinder('Tow eye',(s*.72,y,.74),(s*.72,y+.09,.74),.085,4,'Hull',16)
            box('Side stowage',(s*1.10,.70,1.34),(.18,1.0,.25),6,'Hull',.025)
            box('Unit marking',(s*.889,-.37,1.78),(.012,.22,.22),15,'Turret',.001)
        for x in [-.48,.0,.48]:
            box('Rear field pack',(x,1.69,1.72),(.40,.36,.32),1,'Hull',.04)
        muzzle=[0,1.85,3.31];scale=1.45
    elif car:
        box('Chassis',(0,0,.57),(1.50,3.3,.20),8,'Hull',.035)
        box('Armored body',(0,.1,.98),(1.49,2.52,.62),6,'Hull',.05)
        box('Engine bonnet',(0,-1.25,.95),(1.20,1.01,.39),6,'Hull',.055)
        cab=box('Sloped windscreen',(0,-.48,1.43),(1.37,.12,.57),6,'Hull',.022);cab.rotation_euler.x=-.29
        box('Roof',(0,.18,1.70),(1.32,1.28,.1),6,'Hull',.035)
        for s in [-1,1]:
            box('Vision slit',(s*.34,-.573,1.48),(.25,.013,.055),8,'Hull',.003)
            box('Side door',(s*.76,.18,1.15),(.025,1.08,.66),6,'Hull',.018)
            box('Door hinge',(s*.787,.60,1.18),(.028,.045,.24),4,'Hull',.005)
            box('Door handle',(s*.80,-.2,1.27),(.035,.11,.025),8,'Hull',.007)
            box('Running board',(s*.87,.07,.56),(.36,1.15,.08),8,'Hull',.018)
            for j,y in enumerate([-1.13,1.12]):
                bn=f'Wheel{s}_{j}';bones.append((bn,(s*.88,y,.47),(s*1.12,y,.47),'Root'))
                wheel('Pneumatic wheel',s*.88,y,.47,.47,.29,bn)
                box('Wheel fender',(s*.90,y,1.02),(.48,1.10,.08),6,'Hull',.035)
            cylinder('Headlamp housing',(s*.58,-1.73,.88),(s*.58,-1.86,.88),.115,8,'Hull')
            cylinder('Headlamp glass',(s*.58,-1.863,.88),(s*.58,-1.87,.88),.096,12,'Hull')
            box('Faction plate',(s*.78,.2,1.22),(.016,.23,.20),15,'Hull',.002)
        for x in range(11):box('Radiator grille',(-.43+x*.086,-1.764,.95),(.021,.018,.28),8,'Hull',.003)
        cylinder('Turret base',(0,.25,1.72),(0,.25,1.80),.48,8,'Turret',32)
        loft('Faceted turret',[(0,.25,1.79,.48,.49),(0,.25,2.17,.38,.40),(0,.25,2.21,.32,.35)],6,'Turret',12)
        cylinder('Turret hatch',(0,.25,2.21),(0,.25,2.24),.29,6,'Turret',28)
        cylinder('Machine gun',(0,-.17,1.98),(0,-1.13,1.98),.029,4,'Gun',20)
        for j in range(10):cylinder('Cooling jacket',(0,-.31-j*.055,1.98),(0,-.327-j*.055,1.98),.038,8,'Gun',16)
        box('Bumper',(0,-1.87,.54),(1.76,.12,.13),8,'Hull',.025)
        muzzle=[0,1.98,1.13];scale=1.65
    else:
        # Compact split-trail field gun. Trails fold for travel, spread to fire.
        bones[1]=('Hull',(0,0,.7),(0,0,1.0),'Root')
        box('Axle carriage',(0,0,.65),(1.75,.36,.25),6,'Hull',.025)
        for s in [-1,1]:
            bn=f'Wheel{s}_0';bones.append((bn,(s*.94,0,.58),(s*1.15,0,.58),'Root'))
            wheel('Gun wheel',s*.94,0,.58,.58,.21,bn)
            trail=f'Trail{s}';bones.append((trail,(s*.36,.1,.65),(s*.65,1.7,.24),'Root'))
            obj=box('Box section trail',(s*.64,1.15,.36),(.19,2.4,.19),6,trail,.022)
            obj.rotation_euler=(Vector((s*.92,2.35,.1))-Vector((s*.36,0,.63))).to_track_quat('Y','Z').to_euler()
            box('Trail spade',(s*.94,2.33,.1),(.44,.28,.19),8,trail,.02)
            box('Split gun shield',(s*.44,-.28,1.22),(.83,.065,1.13),6,'Hull',.023)
            for z in [.78,1.1,1.6]:cylinder('Shield rivet',(s*.77,-.317,z),(s*.77,-.331,z),.022,4,'Hull',10)
        box('Cradle',(0,-.17,1.17),(.39,.79,.32),6,'Turret',.04)
        cylinder('Barrel breech',(0,.38,1.40),(0,-.52,1.40),.155,4,'Gun',28)
        cylinder('Barrel',(0,-.5,1.40),(0,-2.65,1.40),.10,6,'Gun',32,r2=.064)
        cylinder('Open bore',(0,-2.651,1.4),(0,-2.66,1.4),.049,8,'Gun',24)
        cylinder('Recoil recuperator',(0,.26,1.21),(0,-1.52,1.21),.082,6,'Gun',24)
        box('Breech block',(0,.43,1.40),(.28,.21,.28),4,'Gun',.028)
        cylinder('Elevation shaft',(-.30,-.05,1.16),(-.55,-.05,1.16),.027,4,'Turret')
        for k in range(8):
            a=k*math.tau/8
            cylinder('Handwheel spoke',(-.55,-.05,1.16),(-.55,-.05+math.sin(a)*.16,1.16+math.cos(a)*.16),.012,4,'Turret',10)
        box('Shield marking',(.45,-.318,1.38),(.21,.01,.19),15,'Hull',.001)
        muzzle=[0,1.40,2.66];scale=1.65
    # Consistent sockets point at the actual muzzle in the rest pose.
    bones[4]=('Muzzle',(muzzle[0],-muzzle[2],muzzle[1]),(muzzle[0],-muzzle[2]-.15,muzzle[1]),'Gun')
    return rig(bones),{'scale':2.0,'stride':2.8 if car else 2.2,'muzzle':muzzle}

def animate(arm,kind):
    clips={'Idle':(60,2),'Walk':(30,1),'Reverse':(36,1.2),'Fire':(90,3),
           'Reload':(90,3),'Deploy':(45,1.5),'Death':(60,2),'Run':(24,.8)}
    def point_bone(name,head,tail):
        p=arm.pose.bones[name];rest=arm.data.bones[name]
        direction=Vector(tail)-Vector(head)
        rotation=(rest.tail_local-rest.head_local).rotation_difference(direction) @ rest.matrix_local.to_quaternion()
        p.matrix=Matrix.LocRotScale(Vector(head),rotation,Vector((1,1,1)))
        bpy.context.view_layer.update()

    def arms(aim,kick=0,reload=0):
        # Analytic two-bone IK, baked to the rig. Both hands support the rifle.
        z=.99+aim*.37
        offset=Vector((.10,0,z-.97))
        weapon=arm.pose.bones['Weapon']
        weapon.matrix=Matrix.Translation(offset+Vector((0,kick*.025,0))) @ arm.data.bones['Weapon'].matrix_local
        bpy.context.view_layer.update()
        for side,s,y in [('R',-1,-.25),('L',1,-.51)]:
            shoulder=Vector((s*.195,0,1.405))
            wrist=Vector((-.12,y,z-.02))
            if side=='R':wrist+=Vector((-.03*reload,.10*reload,-.09*reload))
            upper=arm.data.bones[side+'Arm'].length;lower=arm.data.bones[side+'Forearm'].length
            delta=wrist-shoulder;d=min(delta.length,upper+lower-.002);axis=delta.normalized()
            along=(upper*upper-lower*lower+d*d)/(2*d)
            bend=Vector((s*.6,.18,-1));bend=(bend-axis*bend.dot(axis)).normalized()
            elbow=shoulder+axis*along+bend*math.sqrt(max(0,upper*upper-along*along))
            wrist=shoulder+axis*d
            point_bone(side+'Arm',shoulder,elbow)
            point_bone(side+'Forearm',elbow,wrist)
            point_bone(side+'Hand',wrist,wrist+Vector((0,-.06,-.015)))

    # Sample poses at export cadence so the GLB needs no runtime IK or constraints.
    for name,(last,duration) in clips.items():
        action=bpy.data.actions.new(name);arm.animation_data_create();arm.animation_data.action=action
        for f in range(0,last+1,3):
            t=f/last;wave=math.sin(t*math.tau)
            for p in arm.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0)
            if kind=='infantry':
                if name in ('Walk','Reverse','Run'):
                    amount=.48 if name=='Run' else .32
                    if name=='Reverse':amount=-.23
                    for side,s in [('L',1),('R',-1)]:
                        arm.pose.bones[side+'Thigh'].rotation_euler.x=wave*amount*s
                        arm.pose.bones[side+'Shin'].rotation_euler.x=-max(0,-wave*s)*abs(amount)*1.5
                        arm.pose.bones[side+'Foot'].rotation_euler.x=-wave*amount*s*.35
                    arm.pose.bones['Pelvis'].location.y=abs(wave)*.018
                    arm.pose.bones['Chest'].rotation_euler.y=wave*.025
                aim=min(1,t*3) if name=='Deploy' else 1 if name in ('Fire','Reload') else .22
                kick=max(0,1-abs(t-.14)/.045) if name=='Fire' else 0
                arms(aim,kick,math.sin(t*math.pi) if name=='Reload' else 0)
                arm.pose.bones['Head'].rotation_euler.x=aim*.08
                if name=='Idle':arm.pose.bones['Chest'].rotation_euler.x=wave*.006
                if name=='Death':
                    arm.pose.bones['Root'].rotation_euler.x=min(1,t*1.5)*1.4
                    arm.pose.bones['Root'].location.y=-min(1,t*1.5)*.12
            else:
                if name in ('Walk','Reverse','Run'):
                    sign=-1 if name=='Reverse' else 1
                    for p in arm.pose.bones:
                        if p.name.startswith('Wheel'):p.rotation_euler.y=sign*t*math.tau
                        if p.name.startswith('Track'):
                            k=int(p.name.split('_')[1]);s=-1 if p.name.startswith('Track-') else 1
                            distance=(k/64+sign*t/64) % 1 * (6.4+math.tau*.39)
                            if distance<3.2:y,z=-1.6+distance,.10;a=0
                            elif distance<3.2+math.pi*.39:
                                a=(distance-3.2)/.39;y=1.6+math.sin(a)*.39;z=.49-math.cos(a)*.39
                            elif distance<6.4+math.pi*.39:y=1.6-(distance-3.2-math.pi*.39);z=.88;a=math.pi
                            else:
                                a=(distance-6.4-math.pi*.39)/.39+math.pi;y=-1.6+math.sin(a)*.39;z=.49-math.cos(a)*.39
                            rest=arm.data.bones[p.name]
                            p.location=rest.matrix_local.to_3x3().inverted() @ (Vector((s*1.25,y,z))-rest.head_local)
                    arm.pose.bones['Hull'].rotation_euler.x=wave*.008
                if name=='Fire':
                    kick=max(0,1-abs(t-.14)/.065)
                    arm.pose.bones['Gun'].location.y=-kick*.20
                    arm.pose.bones['Hull'].rotation_euler.x=kick*.017
                if kind=='artillery' and name in ('Walk','Reverse','Run','Deploy'):
                    blend=1-t if name=='Deploy' else 1
                    for s in [-1,1]:arm.pose.bones[f'Trail{s}'].rotation_euler.z=s*blend*.22
                if name=='Death':arm.pose.bones['Hull'].rotation_euler.y=t*.07
            for p in arm.pose.bones:
                p.keyframe_insert('rotation_euler',frame=f+1,group=p.name)
                p.keyframe_insert('location',frame=f+1,group=p.name)
        track=arm.animation_data.nla_tracks.new();track.name=name
        strip=track.strips.new(name,1,action);strip.action_frame_start=1;strip.action_frame_end=last+1
        track.mute=True
    arm.animation_data.action=None
    return clips

def preview(mesh,arm,kind):
    scene=bpy.context.scene
    scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
    scene.world.color=(.17,.17,.17)
    # Studio floor is preview-only, excluded from exports.
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor=bpy.context.object;floor.name='Preview floor'
    mat=bpy.data.materials.new('Preview floor');mat.diffuse_color=(.105,.12,.13,1);floor.data.materials.append(mat)
    scale=1 if kind=='infantry' else 3.0
    target=Vector((0,0,.9 if kind=='infantry' else 1))
    bpy.ops.object.camera_add(location=(2.7*scale,-4.4*scale,2.35*scale))
    camera=bpy.context.object;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=2.22 if kind=='infantry' else 7.6
    scene.camera=camera
    for loc,power,size in [((-3,-4,6),550,4),((4,-1,3),220,3),((0,4,5),700,3)]:
        bpy.ops.object.light_add(type='AREA',location=tuple(v*scale for v in loc))
        lamp=bpy.context.object;lamp.data.energy=power*scale*scale;lamp.data.shape='DISK';lamp.data.size=size*scale
        lamp.rotation_euler=(target-lamp.location).to_track_quat('-Z','Y').to_euler()
    scene.view_settings.view_transform='AgX'
    arm.animation_data.action=bpy.data.actions.get('Idle')
    scene.frame_set(1)
    scene.render.filepath=str(PREVIEW/(kind+'.png'))
    for image in bpy.data.images:
        if image.filepath and image.name.startswith('Land shared '):image.filepath='//../../public/models/land/'+Path(image.filepath).name
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(kind+'.blend')))
    bpy.ops.render.render(write_still=True)
    if kind=='infantry':
        arm.animation_data.action=bpy.data.actions.get('Fire');scene.frame_set(10)
        scene.render.filepath=str(PREVIEW/(kind+'-fire.png'));bpy.ops.render.render(write_still=True)

def build(kind):
    global PARTS,DETAILS,MAT
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):bpy.data.actions.remove(action)
    PARTS=[];DETAILS=[]
    if MAT is None:MAT=textures()
    arm,metadata=infantry() if kind=='infantry' else vehicle(kind)
    if kind=='infantry':
        # Unite the tailored garment across shoulders, elbows and knees. Preserve
        # softly blended skin weights rather than leaving visible primitive seams.
        cloth=[ob for ob in PARTS if any(word in ob.name.lower() for word in
               ['trouser','wool sleeve','forearm sleeve','tailored wool','shoulder seam','knee cloth'])]
        samples=[]
        for ob in cloth:
            group=ob.vertex_groups[0].name
            for v in ob.data.vertices:samples.append((ob.matrix_world@v.co,group))
        tree=KDTree(len(samples))
        for i,(point,_) in enumerate(samples):tree.insert(point,i)
        tree.balance()
        bpy.ops.object.select_all(action='DESELECT')
        for ob in cloth:ob.select_set(True);PARTS.remove(ob)
        bpy.context.view_layer.objects.active=cloth[0];bpy.ops.object.join()
        ob=bpy.context.object
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        remesh=ob.modifiers.new('Continuous garment','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.007
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        smooth=ob.modifiers.new('Relax tailored cloth','SMOOTH');smooth.factor=.9;smooth.iterations=4
        bpy.ops.object.modifier_apply(modifier=smooth.name)
        dec=ob.modifiers.new('Garment topology budget','DECIMATE');dec.ratio=.19
        bpy.ops.object.modifier_apply(modifier=dec.name)
        ob.vertex_groups.clear()
        groups={name:ob.vertex_groups.new(name=name) for name in sorted(set(g for _,g in samples))}
        for v in ob.data.vertices:
            weights={}
            for _,i,d in tree.find_n(v.co,8):
                group=samples[i][1];weights[group]=weights.get(group,0)+1/max(.005,d)**2
            total=sum(weights.values())
            for name,weight in sorted(weights.items(),key=lambda pair:-pair[1])[:4]:groups[name].add([v.index],weight/total,'REPLACE')
        for p in ob.data.polygons:p.use_smooth=True
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.01);bpy.ops.object.mode_set(mode='OBJECT')
        for loop in ob.data.uv_layers.active.data:loop.uv=((.025+loop.uv.x*.95)/4,(.025+loop.uv.y*.95)/4)
        ob.name='Continuous weighted wool uniform';PARTS.append(ob)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in PARTS:obj.select_set(True)
    bpy.context.view_layer.objects.active=PARTS[0];bpy.ops.object.join()
    mesh=bpy.context.object;mesh.name='Ironfronts_'+kind
    # Freeze transforms before skinning; one primitive / material per mesh.
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    mesh.parent=arm
    modifier=mesh.modifiers.new('Armature','ARMATURE');modifier.object=arm
    clips=animate(arm,kind)
    bpy.context.scene.render.fps=30
    stats=[]
    for lod,ratio in enumerate([1,.42,.14]):
        obj=mesh.copy();obj.data=mesh.data.copy();bpy.context.collection.objects.link(obj)
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        if ratio<1:
            dec=obj.modifiers.new('Distance simplification','DECIMATE');dec.ratio=ratio
            bpy.ops.object.modifier_apply(modifier=dec.name)
        obj.data.validate(verbose=False,clean_customdata=False)
        obj.data.update()
        obj.data.calc_loop_triangles()
        stats.append({'lod':lod,'triangles':len(obj.data.loop_triangles),'vertices':len(obj.data.vertices)})
        arm.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(OUT/(kind+f'-lod{lod}.glb')),export_format='GLB',
            use_selection=True,export_materials='NONE',export_texcoords=True,export_normals=True,
            export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,
            export_force_sampling=True,export_frame_range=False,export_skins=True,
            export_yup=True,export_extras=True)
        bpy.data.objects.remove(obj,do_unlink=True)
    metadata.update({'kind':kind,'lods':stats,'clips':{n:{'duration':d,'fps':30} for n,(_,d) in clips.items()},
                     'source':f'material/land-armies/{kind}.blend','authoredBy':'Ironfronts / Codex; original procedural Blender source'})
    (OUT/(kind+'.json')).write_text(json.dumps(metadata,indent=2))
    preview(mesh,arm,kind)
    print('IRONFRONTS_ASSET '+json.dumps(metadata),flush=True)

args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
for kind in args or ['infantry','armored-car','tank','artillery']:build(kind)
