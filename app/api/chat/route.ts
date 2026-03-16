import OpenAI from "openai"
import { CosmosClient } from "@azure/cosmos"

/* ---------------- OPENAI ---------------- */

const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_KEY!,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION! },
  defaultHeaders: { "api-key": process.env.AZURE_OPENAI_KEY! }
})

/* ---------------- COSMOS ---------------- */

const cosmos = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT!,
  key: process.env.COSMOS_KEY!
})

const hospitalDB = cosmos.database("hospital-db")
const quantumcareDB = cosmos.database("quantumcare")

const doctorsContainer = hospitalDB.container("doctors")
const patientsContainer = quantumcareDB.container("patients")

/* ---------------- SPECIALTY DETECTION ---------------- */

function detectSpecialty(symptoms:string){

const text = symptoms.toLowerCase()

if(text.includes("chest") || text.includes("heart"))
return "Cardiologist"

if(text.includes("skin") || text.includes("rash"))
return "Dermatologist"

if(text.includes("ear") || text.includes("nose") || text.includes("throat"))
return "ENT Specialist"

return "General Physician"

}

/* ---------------- ADMIN FORMATTER ---------------- */

function formatAppointments(records:any[]){

if(records.length===0)
return "No appointments found."

let reply = "📊 Appointment Records\n\n"

records.forEach((a:any)=>{

reply += `
Reference: ${a.id}

Patient: ${a.name || "Unknown"}
Phone: ${a.phone || "Unknown"}

Doctor: ${a.doctorName}
Specialty: ${a.specialty}

Date: ${a.appointmentDate}
Time: ${a.slot}

`
})

return reply

}

/* ---------------- API ---------------- */

export async function POST(req:Request){

try{

const body = await req.json().catch(()=>({}))
const messages = body.messages || []
const mode = body.mode || "patient"

const lastMessage =
messages[messages.length - 1]?.content || ""

const lowerMessage = lastMessage.toLowerCase()

/* ====================================================
   ADMIN MODE
==================================================== */

if(mode === "admin"){

const today = new Date()

const todayStr = today.toLocaleDateString([],{
day:"2-digit",
month:"short",
year:"numeric"
})

const tomorrow = new Date()
tomorrow.setDate(today.getDate()+1)

const tomorrowStr = tomorrow.toLocaleDateString([],{
day:"2-digit",
month:"short",
year:"numeric"
})

/* ---------- GET ALL APPOINTMENTS ---------- */

const { resources } =
await patientsContainer.items
.query("SELECT * FROM c")
.fetchAll()

const valid =
resources.filter((r:any)=>r.doctorName)

/* ---------- DOCTOR FILTER ---------- */

if(lowerMessage.includes("vikram"))
return Response.json({
reply: formatAppointments(
valid.filter((r:any)=>r.doctorName==="Dr. Vikram Singh")
)
})

if(lowerMessage.includes("anjali"))
return Response.json({
reply: formatAppointments(
valid.filter((r:any)=>r.doctorName==="Dr. Anjali Mehta")
)
})

if(lowerMessage.includes("rajesh"))
return Response.json({
reply: formatAppointments(
valid.filter((r:any)=>r.doctorName==="Dr. Rajesh Sharma")
)
})

/* ---------- TODAY ---------- */

if(lowerMessage.includes("today"))
return Response.json({
reply: formatAppointments(
valid.filter((r:any)=>r.appointmentDate===todayStr)
)
})

/* ---------- TOMORROW ---------- */

if(lowerMessage.includes("tomorrow"))
return Response.json({
reply: formatAppointments(
valid.filter((r:any)=>r.appointmentDate===tomorrowStr)
)
})

/* ---------- BUSIEST DOCTOR ---------- */

if(lowerMessage.includes("busiest")){

const stats:any = {}

valid.forEach((r:any)=>{

if(!stats[r.doctorName])
stats[r.doctorName] = 0

stats[r.doctorName]++

})

let busiest = ""
let max = 0

Object.entries(stats).forEach(([doc,count]:any)=>{

if(count > max){

max = count
busiest = doc

}

})

return Response.json({
reply:`👨‍⚕️ Busiest Doctor

${busiest}

Total Appointments: ${max}`
})

}

/* ---------- COUNT APPOINTMENTS ---------- */

if(lowerMessage.includes("how many"))
return Response.json({
reply:`📊 Total Appointments: ${valid.length}`
})

/* ---------- WEEKLY REPORT ---------- */

if(lowerMessage.includes("weekly")){

const stats:any = {}

valid.forEach((r:any)=>{

if(!stats[r.doctorName])
stats[r.doctorName] = 0

stats[r.doctorName]++

})

let reply = "📊 Weekly Appointment Report\n\n"

Object.entries(stats).forEach(([doctor,count])=>{
reply += `${doctor}: ${count}\n`
})

return Response.json({ reply })

}

/* ---------- DEFAULT ---------- */

return Response.json({
reply: formatAppointments(valid.slice(0,10))
})

}

/* ====================================================
   PATIENT MODE
==================================================== */

const greetings = ["hello","hi","hey","good morning","good evening"]

const phoneRegex = /^[0-9]{10}$/

const userMessages =
messages.filter((m:any)=>m.role==="user")

const phone =
userMessages
.map((m:any)=>m.content.trim())
.find((text:string)=>phoneRegex.test(text))

const name =
userMessages
.map((m:any)=>m.content.trim())
.find((text:string)=>
!phoneRegex.test(text) &&
!greetings.includes(text.toLowerCase())
)

/* ---------- GREETING ---------- */

if(greetings.includes(lowerMessage) && !name){

return Response.json({
reply:"👩‍⚕️ Hello! May I have your full name?"
})

}

/* ---------- ASK NAME ---------- */

if(!name){

return Response.json({
reply:"👩‍⚕️ May I have your full name?"
})

}

/* ---------- ASK PHONE ---------- */

if(!phone){

return Response.json({
reply:"⚠️ Please enter a valid 10-digit mobile number."
})

}

/* ---------- SYMPTOMS ---------- */

let symptoms

if(phone){

const phoneIndex =
userMessages.findIndex((m:any)=>phoneRegex.test(m.content))

symptoms =
userMessages[phoneIndex + 1]?.content?.trim()

}

if(!symptoms){

return Response.json({
reply:"Please describe the symptoms you are experiencing."
})

}

/* ---------- REFERENCE LOOKUP ---------- */

const referenceMatch = lastMessage.match(/QC-\d+/i)

if(referenceMatch){

const reference = referenceMatch[0].toUpperCase()

const query = {
query:"SELECT * FROM c WHERE c.id=@id",
parameters:[{ name:"@id", value:reference }]
}

const { resources } =
await patientsContainer.items.query(query).fetchAll()

if(resources.length===0){

return Response.json({
reply:`⚠️ No appointment found for ${reference}`
})

}

const record = resources[0]

return Response.json({

reply:`
📋 Appointment Details

Reference No: ${record.id}

Patient: ${record.name}
Phone: ${record.phone}

Doctor: ${record.doctorName}
Specialty: ${record.specialty}

Date: ${record.appointmentDate}
Time: ${record.slot}

Location: QuantumCare Hospital
`
})

}

/* ---------- BOOKING INTENT ---------- */

const bookingIntent =
lowerMessage.includes("yes") ||
lowerMessage.includes("book") ||
lowerMessage.includes("schedule") ||
lowerMessage.includes("appointment") ||
lowerMessage.includes("doctor")

if(bookingIntent){

const specialty =
detectSpecialty(symptoms)

const doctorQuery = {

query:
"SELECT * FROM c WHERE c.specialty=@specialty AND c.available=true",

parameters:[
{ name:"@specialty", value:specialty }
]

}

const { resources } =
await doctorsContainer.items.query(doctorQuery).fetchAll()

if(resources.length===0){

return Response.json({
reply:`⚠️ No ${specialty} slots available today.`
})

}

const doctor = resources[0]

const referenceNo = "QC-" + Date.now()

const now = new Date()

const appointmentDate =
now.toLocaleDateString([],{
day:"2-digit",
month:"short",
year:"numeric"
})

const appointment = {

id: referenceNo,
name,
phone,
symptoms,
doctorName: doctor.name,
specialty: doctor.specialty,
appointmentDate,
slot: doctor.slot,
createdAt: now.toISOString()

}

await patientsContainer.items.create(appointment)

await doctorsContainer
.item(doctor.id, doctor.specialty)
.replace({
...doctor,
available:false
})

return Response.json({

reply:`
✅ Appointment Confirmed

📌 Reference ID: ${referenceNo}

👤 Patient: ${name}
📱 Phone: ${phone}

👨‍⚕️ Doctor: ${doctor.name}
🩺 Specialty: ${doctor.specialty}

📅 Date: ${appointmentDate}
⏰ Time: ${doctor.slot}

📍 Location: QuantumCare Hospital

To retrieve later type:
show appointment ${referenceNo}
`

})

}

/* ---------- AI TRIAGE ---------- */

const completion =
await openai.chat.completions.create({

model: process.env.AZURE_OPENAI_DEPLOYMENT!,

messages:[
{
role:"system",
content:`
You are MediAssist AI for QuantumCare Hospital.

You ONLY help with:
• medical symptoms
• doctor recommendations
• hospital appointments
`
},
...messages
]

})

return Response.json({
reply:
completion.choices?.[0]?.message?.content
|| "No response."
})

}

catch(error){

console.error("API Error:",error)

return Response.json({
reply:"AI service error."
})

}

}