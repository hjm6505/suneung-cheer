// 본판_1 — 불꽃의 여정 그림(하늘·불 자리·불씨). 영상쌤의 「수능 응원 영상\편집 도구\scene5.js」(5판)를 값·식 그대로 옮긴 것.
// 좌표는 1080×1920 기준 그대로 두고, 그리는 쪽(app.js)이 720×1280으로 줄여 그린다. 모든 그림은 「때 t」만의 함수(상태 없음).
window.SC = (() => {
const W=1080, H=1920;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=t=>{ t=clamp(t); return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2; };
const smooth=t=>{ t=clamp(t); return t*t*(3-2*t); };
const lerp=(a,b,u)=>a+(b-a)*u;
function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const mix3=(c1,c2,u)=>[lerp(c1[0],c2[0],u),lerp(c1[1],c2[1],u),lerp(c1[2],c2[2],u)];
const rgb=(c,a=1)=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;

const STARS=(()=>{ const r=rng(20261119), a=[]; while(a.length<95){ const x=r()*W, y=Math.pow(r(),1.3)*H*0.88; const big=Math.pow(r(),7); const s={ x, y, r:0.7+big*1.3+r()*0.4, b:(0.3+0.55*Math.pow(r(),1.6))*0.55, T1:3.2+r()*5.5, T2:5+r()*9, p1:r()*6.283, p2:r()*6.283, amp:0.12+r()*0.28, tint:r()<0.25?[255,226,206]:r()<0.55?[222,222,255]:[246,244,255], u:r() }; if(Math.hypot(x-540,y-380)<230) continue; a.push(s); } return a; })();
const CLOUDS=(()=>{ const r=rng(5), a=[]; for(let i=0;i<5;i++) a.push({ x:r()*W, y:1330+i*105+r()*40, w:520+r()*460, h:26+r()*24, v:3+r()*4, a:0.5+r()*0.5 }); return a; })();
const NOISE=(()=>{ const c=document.createElement('canvas'); c.width=c.height=256; const g=c.getContext('2d'), d=g.createImageData(256,256), r=rng(3); for(let i=0;i<d.data.length;i+=4){ const v=r()<0.5?0:255; d.data[i]=d.data[i+1]=d.data[i+2]=v; d.data[i+3]=7; } g.putImageData(d,0,0); return c; })();

// 하늘빛 네 띠(위 → 아래). EVE = 저녁, NIGHT = 깊은 밤. (5판은 새벽빛 없음)
const EVE=[[30,34,88],[40,44,102],[48,53,112],[54,58,117]], NIGHT=[[7,7,24],[11,11,36],[17,16,50],[25,21,62]], STOPS=[0,0.42,0.8,1];
const nightAt=(t,P)=>smooth((t-(P.tiltStart+0.8))/P.nightLen)*(1-smooth((t-P.downStart)/(P.downLen*0.8)));
const skyShift=(t,P)=>-130*(1-ease((t-P.tiltStart)/10))-110*ease((t-P.downStart)/P.downLen);

function drawSky(g,t,P){ const n=nightAt(t,P), sh=skyShift(t,P);
 const gr=g.createLinearGradient(0,0,0,H); for(let i=0;i<4;i++) gr.addColorStop(STOPS[i],rgb(mix3(EVE[i],NIGHT[i],n)));
 g.fillStyle=gr; g.fillRect(0,0,W,H);
 for(const c of CLOUDS){ const x=((c.x+c.v*(t-17))%(W+c.w))-c.w*0.3; g.save(); g.translate(x,c.y); g.scale(c.w/100,c.h/100);
  const cg=g.createRadialGradient(0,0,0,0,0,100); const col=mix3([70,58,112],[30,26,66],n); cg.addColorStop(0,rgb(col,0.10*c.a)); cg.addColorStop(0.6,rgb(col,0.05*c.a)); cg.addColorStop(1,rgb(col,0)); g.fillStyle=cg; g.fillRect(-100,-100,200,200); g.restore(); }
 g.save(); g.globalCompositeOperation='lighter';
 for(const s of STARS){ const ta=P.tiltStart+3+s.u*9; if(t<ta) continue; const y=s.y+sh; if(y<-20||y>H+20) continue;
  const tw=1-s.amp*(0.5+0.5*Math.sin(6.283*t/s.T1+s.p1))*(0.6+0.4*Math.sin(6.283*t/s.T2+s.p2));
  const horizon=clamp((y-H*0.55)/(H*0.4)); const a=s.b*tw*smooth((t-ta)/2.2)*n*(1-0.75*horizon); if(a<=0.01) continue;
  g.fillStyle=rgb(s.tint,Math.min(1,a)); g.beginPath(); g.arc(s.x,y,s.r,0,6.283); g.fill(); }
 g.restore();
 g.fillStyle=g.createPattern(NOISE,'repeat'); g.fillRect(0,0,W,H);
}

// 모닥불이 화면에서 어디에 어떻게 놓이나. 올라갈 때(up)는 활활 타는 불이 아래로 빠지고, 내려올 때(down)는 사그라든 불이 아래에서 올라온다.
const growAt=(t,P)=>Math.pow(clamp((t-P.igniteAt)/(P.growEnd-P.igniteAt)),1.15);
function fireState(t,P){ const pz=P.pullZoom??0.09;
 if(t<P.fireGone){ const z=1+0.05*smooth((t-P.riseAt+2)/8)+0.05*smooth((t-P.tiltStart)/5); const y=H*0.66*ease((t-P.tiltStart)/(P.fireGone-P.tiltStart+0.6)); return { on:true, kind:'up', a:1-smooth((t-(P.tiltStart+1.5))/(P.fireGone-P.tiltStart-1.5)), z, y, dark:0.1*smooth((t-P.riseAt+2)/8), mask:smooth((t-P.tiltStart)/1.2) }; }
 if(t>=P.downStart){ const u=(t-P.downStart)/P.downLen; return { on:true, kind:'down', a:smooth((u-0.12)/0.55), z:1+pz-pz*smooth((t-P.pullAt)/(P.growEnd-P.pullAt)), y:H*0.66*(1-ease(u)), dark:0, mask:1-smooth((u-0.7)/0.3), G:growAt(t,P) }; }
 return { on:false }; }
// 자라는 불: 사그라든 불 위에 활활 타는 불을 둥근 지붕 꼴(불 밑동을 가운데로 한 타원) 안에만 얹는다.
function growMask(G,P){ const e=Math.pow(G,0.9); return { cx:P.landX+10, cy:P.growBaseY, rx:lerp(P.growRx[0],P.growRx[1],e), ry:lerp(P.growRy[0],P.growRy[1],e), core:smooth(G/0.1), amb:smooth((G-0.6)/0.4) }; }
// 불이 붙는 순간의 불빛(내려앉은 자리에서 번졌다 잦아듦)
function drawIgnite(g,t,P){ const u=(t-P.igniteAt)/1.6; if(u<=-0.15||u>=1) return; const k=u<0?smooth((u+0.15)/0.15):Math.pow(1-u,1.6); const R=260+240*clamp(u); g.save(); g.globalCompositeOperation='lighter'; const gg=g.createRadialGradient(P.landX,P.landY,0,P.landX,P.landY,R); gg.addColorStop(0,rgb([255,220,160],0.8*k)); gg.addColorStop(0.3,rgb([255,160,80],0.32*k)); gg.addColorStop(1,'rgba(255,130,60,0)'); g.fillStyle=gg; g.fillRect(P.landX-R,P.landY-R,R*2,R*2); g.restore(); }

// 불티 하나. 길은 목록의 sparkPath([뒤 몇 초, 높이] 점들)를 부드럽게 잇는다.
function pathY(K,tt){ if(tt<=K[0][0]) return K[0][1]; if(tt>=K[K.length-1][0]) return K[K.length-1][1]; let i=0; while(tt>K[i+1][0]) i++; const p0=K[Math.max(0,i-1)],p1=K[i],p2=K[i+1],p3=K[Math.min(K.length-1,i+2)]; const h=p2[0]-p1[0], u=(tt-p1[0])/h;
 const m1=i===0?(p2[1]-p1[1])/h:(p2[1]-p0[1])/(p2[0]-p0[0]), m2=i+2>K.length-1?(p2[1]-p1[1])/h*0.4:(p3[1]-p1[1])/(p3[0]-p1[0]); const u2=u*u,u3=u2*u; return (2*u3-3*u2+1)*p1[1]+(u3-2*u2+u)*h*m1+(-2*u3+3*u2)*p2[1]+(u3-u2)*h*m2; }
function sparkPos(t,P){ const K=P.sparkPath, len=K[K.length-1][0], D=P.downPath; if(t>=D[0][0]){ const u=clamp((t-D[0][0])/(D[D.length-1][0]-D[0][0])); return { x:lerp(P.restX,P.landX,smooth(u))+Math.sin(u*9)*14*(1-u), y:pathY(D,t), u:1 }; }
 const u=clamp((t-P.riseAt)/len), e=smooth(u), rest=t-(P.riseAt+len); return { x:lerp(P.sparkX0,P.restX,e)+Math.sin(u*7+1)*30*(1-u)*smooth(u*5), y:pathY(K,t-P.riseAt)+(rest>0?5*Math.sin(6.283*rest/7)*smooth(rest/3):0), u }; }
function sparkAt(t,P){ const p=sparkPos(t,P); const a=smooth((t-P.pieceFade)/P.pieceFadeLen)*(1-smooth((t-P.igniteAt)/0.5)); const breathe=1+0.07*Math.sin(6.283*t/4.6); const fall=smooth((t-P.downPath[0][0])/1.0);
 return { x:p.x, y:p.y, a, r:6.4*breathe*(1+0.25*fall), glow:128*breathe*(1+0.3*fall), bright:1+0.3*fall }; }
// 떨어져 나온 불꽃 조각: 처음엔 제 크기(1), 오르며 흔들리고 조금씩 작아져 불씨 크기가 된다
function pieceAt(t,P){ if(t<P.riseAt||t>P.pieceFade+P.pieceFadeLen) return null; const p=sparkPos(t,P); const u=clamp((t-P.riseAt)/(P.pieceFade+P.pieceFadeLen-P.riseAt)); const s=lerp(1,P.pieceMin,Math.pow(u,0.8));
 return { x:p.x, y:p.y, s, rot:Math.sin(t*2.3)*0.10*smooth(u*6)+Math.sin(t*1.1+1)*0.05, a:smooth((t-P.riseAt)/0.8)*(1-smooth((t-P.pieceFade)/P.pieceFadeLen)) }; }
function drawSpark(g,t,P){ if(t<P.pieceFade||t>P.igniteAt+0.6) return; const s=sparkAt(t,P); if(s.a<=0.003) return; g.save(); g.globalCompositeOperation='lighter';
 const gg=g.createRadialGradient(s.x,s.y,0,s.x,s.y,s.glow); gg.addColorStop(0,rgb([255,222,160],0.5*s.a)); gg.addColorStop(0.12,rgb([255,186,96],0.3*s.a)); gg.addColorStop(0.4,rgb([255,150,60],0.09*s.a*s.bright)); gg.addColorStop(1,'rgba(255,140,50,0)'); g.fillStyle=gg; g.fillRect(s.x-s.glow,s.y-s.glow,s.glow*2,s.glow*2);
 g.fillStyle=rgb([255,242,208],s.a); g.beginPath(); g.arc(s.x,s.y,s.r,0,6.283); g.fill(); g.restore(); }
return { clamp, ease, smooth, lerp, drawSky, fireState, growAt, growMask, drawIgnite, pieceAt, drawSpark };
})();
