const path = require('path'); const express = require('express'); const app = express();
const WEB = path.join(__dirname, 'web');
app.use('/assets', express.static(path.join(WEB,'assets')));
app.use('/vendor', express.static(path.join(WEB,'vendor')));
app.use('/partenaires', express.static(path.join(WEB,'portal')));
app.get('/partenaires/config.json',(_q,r)=>r.json({supabaseUrl:'https://d.supabase.co',supabaseAnonKey:'d'}));
app.get(['/partenaires','/partenaires/'],(_q,r)=>r.sendFile(path.join(WEB,'portal','index.html')));
const jour=86400000, motif=[0,0,336,0,168,0,0,504,336,0,0,168,336,0,672,336,0,0,504,336,168,0,336,672,0,336,504,336,672,840];
const series=motif.map((c,i)=>({date:new Date(Date.now()-(29-i)*jour).toISOString().slice(0,10),cents:c}));
const d=(data)=>({success:true,data});
app.get('/api/v1/partner/me',(_q,r)=>r.json(d({partner:{displayName:'bovan',rateBps:4000,isFounder:true,code:'BOVAN'}})));
app.get('/api/v1/partner/stats',(_q,r)=>r.json(d({signups:300,activeSubscribers:39,monthCents:13776,balance:{pendingCents:17808,validatedCents:13104,paidCents:12096},series,trendPct:22})));
app.get('/api/v1/partner/referrals',(_q,r)=>r.json(d({referrals:[
 {member:'Y•••',attributedAt:'2026-07-19',tier:null,active:false,shareCents:null},
 {member:'S•••',attributedAt:'2026-07-18',tier:null,active:false,shareCents:null},
 {member:'M•••',attributedAt:'2026-07-12',tier:'or',active:true,shareCents:336},
 {member:'F•••',attributedAt:'2026-07-03',tier:'prestige',active:true,shareCents:560}]})));
app.get('/api/v1/partner/payouts',(_q,r)=>r.json(d({payouts:[{id:'1',amountCents:12096,method:'Orange Money',reference:'SEED-DEMO-01',paidAt:'2026-06-29'}]})));
app.listen(4403,()=>console.log('demo 4403'));
