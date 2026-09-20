from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import math, os

root=Path(r"C:\localmcpcoder\WORKSPACE\AxiomCode\assets\branding")
root.mkdir(parents=True, exist_ok=True)

def font(size,bold=True):
    candidates=[
        r"C:\Windows\Fonts\seguisb.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"
    ]
    for p in candidates:
        if Path(p).exists(): return ImageFont.truetype(p,size)
    return ImageFont.load_default()

def gradient(c1,c2,t):
    return tuple(int(a+(b-a)*t) for a,b in zip(c1,c2))

def symbol(size=1024, transparent=True):
    bg=(0,0,0,0) if transparent else (0,0,0,255)
    im=Image.new("RGBA",(size,size),bg)
    glow=Image.new("RGBA",(size,size),(0,0,0,0))
    gd=ImageDraw.Draw(glow)
    cx=cy=size//2
    r=int(size*.39)
    for w in range(int(size*.045),0,-4):
        alpha=int(70*(w/(size*.045)))
        gd.ellipse((cx-r,cy-r,cx+r,cy+r),outline=(0,180,255,alpha),width=max(1,w))
    glow=glow.filter(ImageFilter.GaussianBlur(size*.012))
    im.alpha_composite(glow)
    dr=ImageDraw.Draw(im)

    # orbital ring
    dr.arc((cx-r,cy-r,cx+r,cy+r),-48,282,fill=(20,165,255,255),width=max(6,size//80))
    dr.arc((cx-r+10,cy-r+10,cx+r-10,cy+r-10),150,275,fill=(20,80,210,210),width=max(3,size//120))

    # stylized angular A/ribbon
    outer=[
      (int(size*.18),int(size*.73)),(int(size*.47),int(size*.19)),(int(size*.57),int(size*.20)),
      (int(size*.74),int(size*.46)),(int(size*.64),int(size*.54)),(int(size*.52),int(size*.35)),
      (int(size*.32),int(size*.77))
    ]
    dr.polygon(outer,fill=(18,165,255,255))
    dr.polygon([
      (int(size*.18),int(size*.73)),(int(size*.47),int(size*.19)),(int(size*.54),int(size*.32)),
      (int(size*.32),int(size*.77))
    ],fill=(10,85,225,255))
    dr.polygon([
      (int(size*.38),int(size*.57)),(int(size*.48),int(size*.47)),(int(size*.72),int(size*.73)),
      (int(size*.63),int(size*.81))
    ],fill=(0,210,255,255))

    # code badge
    badge=[(int(size*.60),int(size*.53)),(int(size*.79),int(size*.43)),(int(size*.88),int(size*.56)),(int(size*.76),int(size*.75))]
    dr.rounded_polygon = getattr(dr, "rounded_polygon", None)
    dr.polygon(badge,fill=(8,85,220,255))
    lw=max(8,size//55)
    dr.line([(int(size*.67),int(size*.58)),(int(size*.63),int(size*.62)),(int(size*.67),int(size*.66))],fill=(130,250,255,255),width=lw,joint="curve")
    dr.line([(int(size*.80),int(size*.58)),(int(size*.84),int(size*.62)),(int(size*.80),int(size*.66))],fill=(130,250,255,255),width=lw,joint="curve")
    dr.line([(int(size*.75),int(size*.55)),(int(size*.72),int(size*.69))],fill=(160,255,255,255),width=lw)

    # highlights
    hl=Image.new("RGBA",(size,size),(0,0,0,0))
    hd=ImageDraw.Draw(hl)
    hd.line([(int(size*.47),int(size*.20)),(int(size*.74),int(size*.46))],fill=(160,255,255,170),width=max(4,size//90))
    hl=hl.filter(ImageFilter.GaussianBlur(size*.004))
    im.alpha_composite(hl)
    return im

icon=symbol(1024,True)
icon.resize((512,512),Image.Resampling.LANCZOS).save(root/"axiomcode-icon.png",optimize=True)
icon.save(root/"axiomcode.ico",format="ICO",sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])

# full wordmark on black
W=1400; H=1000
brand=Image.new("RGBA",(W,H),(0,0,0,255))
sym=symbol(720,True)
brand.alpha_composite(sym,(340,35))
dr=ImageDraw.Draw(brand)
name1="Axiom"; name2="Code"
f=font(120,True)
b1=dr.textbbox((0,0),name1,font=f); b2=dr.textbbox((0,0),name2,font=f)
total=(b1[2]-b1[0])+(b2[2]-b2[0])
x=(W-total)//2; y=745
dr.text((x,y),name1,font=f,fill=(245,245,245,255))
dr.text((x+(b1[2]-b1[0]),y),name2,font=f,fill=(0,175,255,255))
tag="CODE WITHOUT LIMITS"
tf=font(34,False)
tb=dr.textbbox((0,0),tag,font=tf)
dr.text(((W-(tb[2]-tb[0]))//2,900),tag,font=tf,fill=(205,215,225,255))
brand.resize((840,600),Image.Resampling.LANCZOS).save(root/"axiomcode-logo.png",optimize=True)
print("generated",root)