import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
const cors = {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"same-origin","Vary":"Cookie"};
const json=(statusCode,body,headers={})=>({statusCode,headers:{...cors,...headers},body:JSON.stringify(body)});
const cookieName="tp_admin_session";
function sign(value){return crypto.createHmac('sha256',process.env.SESSION_SECRET||'replace-this-secret-in-netlify').update(value).digest('hex')}
function sessionToken(){const payload=Buffer.from(JSON.stringify({exp:Date.now()+8*60*60*1000,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');return payload+'.'+sign(payload)}
function validSession(event){const raw=(event.headers.cookie||event.headers.Cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!raw)return false;const [p,s]=raw.split('.');if(!p||!s||!crypto.timingSafeEqual(Buffer.from(s.padEnd(64,'0').slice(0,64)),Buffer.from(sign(p))))return false;try{return JSON.parse(Buffer.from(p,'base64url').toString()).exp>Date.now()}catch{return false}}
export default async (event)=>{
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:{'Access-Control-Allow-Origin':'same-origin','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'}};
 if(event.httpMethod!=='POST')return json(405,{ok:false,error:'Method not allowed'});
 let body;try{body=JSON.parse(event.body||'{}')}catch{return json(400,{ok:false,error:'Invalid request'})}
 const action=body.action;
 if(action==='submit'){
  const d=body.payload||{};if(!String(d.client||'').trim()||!String(d.project||'').trim()||!Array.isArray(d.events)||!d.events.length)return json(400,{ok:false,error:'Client name, project name এবং অন্তত একটি event দিন।'});
  const id=crypto.randomUUID();const record={...d,id,submittedAt:new Date().toISOString()};
  try{const store=getStore('tumpa-song-submissions');await store.setJSON(id,record);const index=await store.get('index',{type:'json'})||[];index.push({id,submittedAt:record.submittedAt});await store.setJSON('index',index);return json(200,{ok:true,id})}catch(e){return json(500,{ok:false,error:'ডেটাবেসে সংরক্ষণ করা যায়নি। Netlify deployment/Blobs setup পরীক্ষা করুন।'})}
 }
 if(action==='login'){
  const u=process.env.ADMIN_USERNAME,p=process.env.ADMIN_PASSWORD;if(!u||!p||!process.env.SESSION_SECRET)return json(500,{ok:false,error:'Netlify Site configuration-এ ADMIN_USERNAME, ADMIN_PASSWORD ও SESSION_SECRET সেট করুন।'});
  const ok=String(body.username||'')===u&&String(body.password||'')===p;if(!ok)return json(401,{ok:false,error:'Username বা password ভুল।'});
  const token=sessionToken();return json(200,{ok:true,data:{loggedIn:true}},{'Set-Cookie':`${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`});
 }
 if(action==='logout')return json(200,{ok:true,data:true},{'Set-Cookie':`${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`});
 if(action==='list'){
  if(!validSession(event))return json(401,{ok:false,error:'Session শেষ হয়েছে। আবার login করুন।'});
  try{const store=getStore('tumpa-song-submissions');const index=await store.get('index',{type:'json'})||[];const records=await Promise.all(index.map(async x=>await store.get(x.id,{type:'json'})));return json(200,{ok:true,data:records.filter(Boolean).sort((a,b)=>String(a.submittedAt).localeCompare(String(b.submittedAt)))})}catch(e){return json(500,{ok:false,error:'ডেটাবেস পড়া যায়নি।'})}
 }
 return json(400,{ok:false,error:'Unknown action'});
};
