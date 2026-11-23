import express from "express";
import OpenAI from "openai";
import crypto from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "90kb" }));
const client = new OpenAI({ maxRetries: 0 });
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_SITE_ORIGIN = "https://slavakam-source.github.io";
function canonicalOrigin(value) {
 try { return new URL(value.trim()).origin; } catch { return ""; }
}
const ALLOWED_ORIGINS = new Set([PUBLIC_SITE_ORIGIN, canonicalOrigin(process.env.ALLOWED_ORIGIN || "")].filter(Boolean));
function originAllowed(req) {
 return ALLOWED_ORIGINS.has(req.get("Origin") || "");
}
const LESSON_CODE = process.env.LESSON_ACCESS_CODE || "";
const HISTORY = new Map();
const WINDOW = 60 * 60 * 1000;
const MAX_SESSIONS = 6;

const teachingInstructions = [
 "Ты Чатик, доброжелательный голосовой преподаватель для ребёнка 9 лет, который занимается вместе со взрослым.",
 "Разрешённая тема — только математика, конкретно два задания ниже. Не рассказывай истории, не обсуждай другие темы и не выполняй посторонние просьбы.",
 "Отвечай по-русски, очень короткими понятными предложениями, задавай строго один наводящий вопрос за раз и жди ответа.",
 "Не выдавай конечные числовые ответы и секретное слово, пока ученица не найдёт их сама. По просьбе о подсказке давай следующий маленький шаг рассуждения; если ученица ошиблась — помогай заметить противоречие, не ругай.",
 "Не заявляй о проверке письменного ответа, если его не видишь. Можешь попросить произнести ход решения.",
 "Если вопрос не о данных заданиях, скажи: 'Это обсудим после урока со взрослым. Сейчас вернёмся к математике.'",
 "Задача 6: На четыре одинаковых платья пошло 16 метров ситца. Сколько таких платьев получится из 20 метров? Из 40 метров? Сначала выясни расход на одно платье и попроси обосновать действие.",
 "Задача 7: Нужно вычислить значения карточек и расположить буквы в порядке результатов 16, 5, 13, 42, 54, 70. Карточки: 7 умножить на 6 — Е; 9 плюс 7 — П; 91 минус 78 — Б; 10 умножить на 7 — А; 50 разделить на 10 — О; 18 умножить на 3 — Д.",
 "Не вводи новые задачи. Не обращайся к личным данным и не спрашивай адрес, школу, телефон, фамилию или фотографии.",
 "Начни с приветствия и спроси: 'Ксюша, давай начнём с платьев. Что нужно найти сначала?'",
].join("\n");

function constantTimeEqual(a,b){
 const aa=Buffer.from(a);const bb=Buffer.from(b);
 return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function checkRateLimit(ip){
 const now=Date.now();
 const events=(HISTORY.get(ip)||[]).filter(t=>now-t<WINDOW);
 if(events.length>=MAX_SESSIONS){HISTORY.set(ip,events);return false}
 events.push(now);HISTORY.set(ip,events);return true;
}
app.use((req,res,next)=>{
 if (originAllowed(req)) res.set("Access-Control-Allow-Origin",req.get("Origin"));
 res.set("Vary","Origin");
 res.set("Access-Control-Allow-Headers","Content-Type,X-Lesson-Code");
 res.set("Access-Control-Allow-Methods","POST,OPTIONS,GET");
 res.set("Cache-Control","no-store");
 if(req.method==="OPTIONS")return res.status(204).end();
 next();
});
app.get("/health",(req,res)=>res.json({status:"ok",service:"ksyusha-school-voice",cors:originAllowed(req)?"allowed":"no-browser-origin"}));
app.post("/api/session",async(req,res)=>{
 if(!originAllowed(req))return res.status(403).json({error:"origin_denied"});
 if(!LESSON_CODE || !process.env.OPENAI_API_KEY)return res.status(503).json({error:"server_not_configured"});
 const code=req.header("X-Lesson-Code")||"";
 if(!constantTimeEqual(code,LESSON_CODE))return res.status(403).json({error:"invalid_code"});
 const sdp=req.body?.sdp;
 if(typeof sdp!=="string"||sdp.length<30||sdp.length>90000)return res.status(400).json({error:"invalid_sdp"});
 if(!checkRateLimit(req.ip))return res.status(429).json({error:"session_limit"});
 try{
  const result=await client.live.create({
   session:{model:"gpt-live-1.1",instructions:teachingInstructions},
   transport:{type:"webrtc",sdp}
  });
  return res.status(201).json(result);
 }catch(e){
  const status=Number(e?.status)||0;
  const code=typeof e?.code==="string"?e.code:"unknown";
  const type=typeof e?.type==="string"?e.type:"unknown";
  // Never log the API key, request headers, user audio, or SDP.
  console.error("Voice session failed",JSON.stringify({http_status:status,error_code:code,error_type:type}));
  const category=status===401?"api_auth_failed":status===403?"api_permission_denied":status===429?"api_quota_or_rate_limit":status===400?"api_request_rejected":status===404?"api_model_or_endpoint_unavailable":status>=500?"api_provider_unavailable":"voice_unavailable";
  return res.status(502).json({error:category,upstream_status:status||null});
 }
});
app.listen(PORT,"0.0.0.0",()=>console.log("Voice lesson server listening"));
