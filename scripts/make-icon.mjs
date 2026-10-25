import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const polygon = [[70,60],[186,60],[186,88],[98,88],[98,112],[166,112],[186,132],[186,184],[70,184],[70,156],[158,156],[158,136],[90,136],[70,116]];
function inside(x,y) {
  let hit = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [xi,yi]=polygon[i], [xj,yj]=polygon[j];
    if ((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) hit=!hit;
  }
  return hit;
}
function crc32(bytes) {
  let value=0xffffffff;
  for(const byte of bytes) {
    value^=byte;
    for(let bit=0;bit<8;bit++) value=(value>>>1)^((value&1)?0xedb88320:0);
  }
  return (value^0xffffffff)>>>0;
}
function chunk(type,data) {
  const name=Buffer.from(type), length=Buffer.alloc(4), crc=Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([length,name,data,crc]);
}
function png(size) {
  const rows=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const sum=[0,0,0,0];
    for(let sy=0;sy<4;sy++) for(let sx=0;sx<4;sx++) {
      const px=(x+(sx+.5)/4)*256/size, py=(y+(sy+.5)/4)*256/size;
      const dx=Math.max(50-px,0,px-206), dy=Math.max(50-py,0,py-206);
      const visible=px>=8&&px<=248&&py>=8&&py<=248&&dx*dx+dy*dy<=42*42;
      const color=inside(px,py)?[182,220,91,255]:visible?[20,26,22,255]:[0,0,0,0];
      for(let c=0;c<4;c++) sum[c]+=color[c];
    }
    const offset=y*(size*4+1)+1+x*4;
    for(let c=0;c<4;c++) rows[offset+c]=Math.round(sum[c]/16);
  }
  const header=Buffer.alloc(13);
  header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
const sizes=[16,32,48,64,128,256], images=sizes.map(png), header=Buffer.alloc(6+sizes.length*16);
header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
sizes.forEach((size,i)=>{
  const entry=6+i*16;header[entry]=size===256?0:size;header[entry+1]=size===256?0:size;
  header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;
});
mkdirSync("build",{recursive:true});mkdirSync("public",{recursive:true});
writeFileSync("build/icon.ico",Buffer.concat([header,...images]));
writeFileSync("public/sortframe.png",images.at(-1));
