import{o as e}from"./chunk-CMxvf4Kt.js";import{_ as t,h as n}from"./index-DvlmgyGL.js";import{$t as r,Lt as i,S as a,T as o,Wt as s,X as c,a as l,b as u,d,i as f,kt as p,l as m,n as h,y as g,zt as _}from"./dist-BFRl094e.js";var v=parseInt(`184`.replace(/\D+/g,``)),y=e(t()),b=class extends _{constructor(){super({uniforms:{time:{value:0},fade:{value:1}},vertexShader:`
      uniform float time;
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 0.5);
        gl_PointSize = size * (30.0 / -mvPosition.z) * (3.0 + sin(time + 100.0));
        gl_Position = projectionMatrix * mvPosition;
      }`,fragmentShader:`
      uniform sampler2D pointTexture;
      uniform float fade;
      varying vec3 vColor;
      void main() {
        float opacity = 1.0;
        if (fade == 1.0) {
          float d = distance(gl_PointCoord, vec2(0.5, 0.5));
          opacity = 1.0 / (1.0 + exp(16.0 * (d - 0.25)));
        }
        gl_FragColor = vec4(vColor, opacity);

        #include <tonemapping_fragment>
	      #include <${v>=154?`colorspace_fragment`:`encodings_fragment`}>
      }`})}},x=e=>new r().setFromSpherical(new s(e,Math.acos(1-Math.random()*2),Math.random()*2*Math.PI)),S=y.forwardRef(({radius:e=100,depth:t=50,count:n=5e3,saturation:r=0,factor:i=4,fade:a=!1,speed:s=1},c)=>{let l=y.useRef(null),[u,d,f]=y.useMemo(()=>{let a=[],s=[],c=Array.from({length:n},()=>(.5+.5*Math.random())*i),l=new o,u=e+t,d=t/n;for(let e=0;e<n;e++)u-=d*Math.random(),a.push(...x(u).toArray()),l.setHSL(e/n,r,.9),s.push(l.r,l.g,l.b);return[new Float32Array(a),new Float32Array(s),new Float32Array(c)]},[n,t,i,e,r]);m(e=>l.current&&(l.current.uniforms.time.value=e.clock.elapsedTime*s));let[p]=y.useState(()=>new b);return y.createElement(`points`,{ref:c},y.createElement(`bufferGeometry`,null,y.createElement(`bufferAttribute`,{attach:`attributes-position`,args:[u,3]}),y.createElement(`bufferAttribute`,{attach:`attributes-color`,args:[d,3]}),y.createElement(`bufferAttribute`,{attach:`attributes-size`,args:[f,1]})),y.createElement(`primitive`,{ref:l,object:p,attach:`material`,blending:2,"uniforms-fade-value":a,depthWrite:!1,transparent:!0,vertexColors:!0}))});function C(e){return e<640?`mobile`:e<1024?`tablet`:`desktop`}var w=typeof window<`u`;function T(){let[e,t]=(0,y.useState)(w?window.innerWidth:1280),[n,r]=(0,y.useState)(!1);(0,y.useEffect)(()=>{if(!w)return;let e=0,n=()=>{cancelAnimationFrame(e),e=requestAnimationFrame(()=>t(window.innerWidth))};window.addEventListener(`resize`,n);let i=window.matchMedia(`(prefers-reduced-motion: reduce)`),a=()=>r(i.matches);return a(),i.addEventListener(`change`,a),()=>{window.removeEventListener(`resize`,n),i.removeEventListener(`change`,a),cancelAnimationFrame(e)}},[]);let i=C(e);return{width:e,breakpoint:i,isMobile:i===`mobile`,isTablet:i===`tablet`,isDesktop:i===`desktop`,reducedMotion:n}}var E=n();function D({count:e=4e3,animate:t=!0}){return(0,E.jsx)(S,{radius:120,depth:60,count:e,factor:4,saturation:0,fade:!0,speed:t?.6:0})}function O(e){switch(e){case`mobile`:return{nodes:60,neighbors:2,pulses:16,dpr:[1,1.5],bloom:.9,stars:900};case`tablet`:return{nodes:95,neighbors:3,pulses:26,dpr:[1,1.7],bloom:1.1,stars:1600};default:return{nodes:140,neighbors:3,pulses:40,dpr:[1,2],bloom:1.25,stars:2600}}}function k(){let e=document.createElement(`canvas`);e.width=e.height=64;let t=e.getContext(`2d`),n=t.createRadialGradient(64/2,64/2,0,64/2,64/2,64/2);n.addColorStop(0,`rgba(255,255,255,1)`),n.addColorStop(.25,`rgba(186,245,253,0.9)`),n.addColorStop(.6,`rgba(34,211,238,0.35)`),n.addColorStop(1,`rgba(34,211,238,0)`),t.fillStyle=n,t.fillRect(0,0,64,64);let r=new a(e);return r.colorSpace=i,r}function A(e,t){let n=[];for(let t=0;t<e;t++){let e=Math.random()*2-1,t=Math.random()*Math.PI*2,i=Math.cbrt(Math.random()),a=Math.sqrt(1-e*e);n.push(new r(Math.cos(t)*a*i*2.55,e*i*1.55,Math.sin(t)*a*i*1.5))}let i=0,a=1/0;n.forEach((e,t)=>{let n=e.lengthSq();n<a&&(a=n,i=t)}),n[i].set(0,0,0);let s=new Float32Array(e*3),c=new Float32Array(e*3),l=new Float32Array(e),u=new Float32Array(e),d=new o(`#eafdff`),f=new o(`#22d3ee`),p=new o(`#7dd3fc`);for(let t=0;t<e;t++){let e=n[t];if(s[t*3]=e.x,s[t*3+1]=e.y,s[t*3+2]=e.z,u[t]=Math.random()*Math.PI*2,t===i)l[t]=7,d.toArray(c,t*3);else{let e=Math.random()<.18;l[t]=e?3.4:1.6+Math.random()*1.2,(e?p:f).toArray(c,t*3)}}let m=new Set,h=[],g=(e,t)=>{let r=e<t?`${e}_${t}`:`${t}_${e}`;m.has(r)||(m.add(r),h.push({a:n[e],b:n[t]}))};for(let r=0;r<e;r++){let a=[];for(let t=0;t<e;t++)t!==r&&a.push({j:t,d:n[r].distanceToSquared(n[t])});a.sort((e,t)=>e.d-t.d);for(let e=0;e<t&&e<a.length;e++)g(r,a[e].j);Math.random()<.12&&r!==i&&g(r,i)}let _=new Float32Array(h.length*6);return h.forEach((e,t)=>{_[t*6]=e.a.x,_[t*6+1]=e.a.y,_[t*6+2]=e.a.z,_[t*6+3]=e.b.x,_[t*6+4]=e.b.y,_[t*6+5]=e.b.z}),{positions:s,colors:c,sizes:l,phases:u,linePositions:_,edges:h}}function j({quality:e,animate:t}){let n=(0,y.useRef)(null),r=(0,y.useMemo)(k,[]),i=typeof window<`u`?Math.min(2,window.devicePixelRatio):1.5,a=(0,y.useMemo)(()=>A(e.nodes,e.neighbors),[e.nodes,e.neighbors]),s=(0,y.useMemo)(()=>{let e=new u;return e.setAttribute(`position`,new g(a.positions,3)),e.setAttribute(`aColor`,new g(a.colors,3)),e.setAttribute(`aSize`,new g(a.sizes,1)),e.setAttribute(`aPhase`,new g(a.phases,1)),e},[a]),l=(0,y.useMemo)(()=>new _({transparent:!0,depthWrite:!1,blending:2,uniforms:{uTime:{value:0},uTex:{value:r},uScale:{value:26*i}},vertexShader:`
          attribute float aSize; attribute float aPhase; attribute vec3 aColor;
          uniform float uTime; uniform float uScale;
          varying vec3 vColor; varying float vTw;
          void main(){
            vColor=aColor;
            float tw=0.6+0.4*sin(uTime*1.6+aPhase);
            vTw=tw;
            vec4 mv=modelViewMatrix*vec4(position,1.0);
            gl_PointSize=aSize*uScale*tw/ -mv.z;
            gl_Position=projectionMatrix*mv;
          }
        `,fragmentShader:`
          uniform sampler2D uTex; varying vec3 vColor; varying float vTw;
          void main(){
            vec4 t=texture2D(uTex, gl_PointCoord);
            if(t.a<0.01) discard;
            gl_FragColor=vec4(vColor*(0.7+0.7*vTw), t.a);
          }
        `}),[r,i]),d=(0,y.useMemo)(()=>{let e=new u;return e.setAttribute(`position`,new g(a.linePositions,3)),e},[a]),f=(0,y.useMemo)(()=>new c({color:new o(`#22d3ee`),transparent:!0,opacity:.14,blending:2,depthWrite:!1}),[]),h=(0,y.useMemo)(()=>{let t=[];for(let n=0;n<e.pulses;n++){let e=a.edges[Math.floor(Math.random()*a.edges.length)];e&&t.push({a:e.a,b:e.b,t:Math.random(),speed:.25+Math.random()*.5})}return t},[a,e.pulses]),v=(0,y.useMemo)(()=>{let e=new u;return e.setAttribute(`position`,new g(new Float32Array(h.length*3),3)),e},[h]),b=(0,y.useMemo)(()=>new p({map:r,size:.16,sizeAttenuation:!0,color:new o(`#baf5fd`),transparent:!0,depthWrite:!1,blending:2}),[r]);return m((e,r)=>{if(l.uniforms.uTime.value=e.clock.elapsedTime,n.current){let r=t?e.pointer.x*.45+e.clock.elapsedTime*.04:0,i=t?-e.pointer.y*.28:0;n.current.rotation.y+=(r-n.current.rotation.y)*.05,n.current.rotation.x+=(i-n.current.rotation.x)*.05}if(t){let e=v.getAttribute(`position`),t=e.array;for(let e=0;e<h.length;e++){let n=h[e];if(n.t+=n.speed*r,n.t>1){--n.t;let e=a.edges[Math.floor(Math.random()*a.edges.length)];e&&(n.a=e.a,n.b=e.b)}t[e*3]=n.a.x+(n.b.x-n.a.x)*n.t,t[e*3+1]=n.a.y+(n.b.y-n.a.y)*n.t,t[e*3+2]=n.a.z+(n.b.z-n.a.z)*n.t}e.needsUpdate=!0}}),(0,E.jsxs)(`group`,{ref:n,children:[(0,E.jsx)(`lineSegments`,{geometry:d,material:f}),(0,E.jsx)(`points`,{geometry:s,material:l}),(0,E.jsx)(`points`,{geometry:v,material:b})]})}function M(){let{camera:e}=d();return(0,y.useMemo)(()=>{e.position.set(0,0,6),e.lookAt(0,0,0)},[e]),null}function N(){let{breakpoint:e,reducedMotion:t}=T(),n=(0,y.useMemo)(()=>O(e),[e]),r=!t;return(0,E.jsxs)(l,{dpr:n.dpr,gl:{antialias:!0,alpha:!0,powerPreference:`high-performance`},camera:{position:[0,0,6],fov:45},style:{width:`100%`,height:`100%`},children:[(0,E.jsx)(M,{}),(0,E.jsxs)(y.Suspense,{fallback:null,children:[(0,E.jsx)(D,{count:n.stars,animate:r}),(0,E.jsx)(j,{quality:n,animate:r})]}),(0,E.jsx)(h,{children:(0,E.jsx)(f,{intensity:n.bloom,luminanceThreshold:.15,luminanceSmoothing:.9,mipmapBlur:!0})})]})}export{N as default};