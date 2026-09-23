const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "bitbooks.db");
const fs = require("fs");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,location TEXT NOT NULL,capacity INTEGER NOT NULL,approval INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY,resourceId TEXT NOT NULL,userName TEXT NOT NULL,date TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,purpose TEXT NOT NULL,status TEXT NOT NULL,createdAt INTEGER NOT NULL);
`);
function uid(){return Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4)}
function seedIfEmpty(){const count=db.prepare("SELECT COUNT(*) AS n FROM resources").get().n;if(count>0)return;const resources=[
{id:uid(),name:"Hall A — Lecture Theatre",type:"Classroom",location:"Main Block, Ground Floor",capacity:120,approval:0},
{id:uid(),name:"Room 214",type:"Classroom",location:"Arts Building, 2nd Floor",capacity:40,approval:0},
{id:uid(),name:"Robotics Lab",type:"Laboratory",location:"Engineering Wing, 1st Floor",capacity:20,approval:1},
{id:uid(),name:"Chemistry Lab B",type:"Laboratory",location:"Science Block, 2nd Floor",capacity:24,approval:1},
{id:uid(),name:"Seminar Room 3",type:"Seminar Room",location:"Library, 3rd Floor",capacity:15,approval:0},
{id:uid(),name:"Auditorium",type:"Facility",location:"Student Centre",capacity:300,approval:1}];
const ins=db.prepare("INSERT INTO resources (id,name,type,location,capacity,approval) VALUES (@id,@name,@type,@location,@capacity,@approval)");resources.forEach(r=>ins.run(r));
const iso=d=>d.toISOString().slice(0,10),today=new Date();
const bookings=[
{id:uid(),resourceId:resources[1].id,userName:"Priya Nair",date:iso(today),start:"10:00",end:"11:00",purpose:"Algorithms tutorial",status:"confirmed",createdAt:Date.now()},
{id:uid(),resourceId:resources[2].id,userName:"Arjun Kumar",date:iso(new Date(today.getTime()+86400000)),start:"14:00",end:"16:00",purpose:"Final year project build",status:"pending",createdAt:Date.now()},
{id:uid(),resourceId:resources[0].id,userName:"Dr. S. Iyer",date:iso(new Date(today.getTime()-2*86400000)),start:"09:00",end:"10:30",purpose:"Guest lecture",status:"completed",createdAt:Date.now()-99999}];
const ib=db.prepare("INSERT INTO bookings (id,resourceId,userName,date,start,end,purpose,status,createdAt) VALUES (@id,@resourceId,@userName,@date,@start,@end,@purpose,@status,@createdAt)");bookings.forEach(b=>ib.run(b))}
seedIfEmpty();
const rowToResource=r=>({...r,approval:!!r.approval}),rowToBooking=b=>({...b});
function overlaps(aS,aE,bS,bE){return aS<bE&&bS<aE}
function findConflict(resourceId,date,start,end,excludeId){const rows=db.prepare("SELECT * FROM bookings WHERE resourceId=? AND date=? AND status IN ('pending','confirmed') AND id!=?").all(resourceId,date,excludeId||"");return rows.find(b=>overlaps(start,end,b.start,b.end))}
const app=express();app.use(express.json());
app.get("/api/resources",(req,res)=>res.json(db.prepare("SELECT * FROM resources ORDER BY name").all().map(rowToResource)));
app.post("/api/resources",(req,res)=>{const {name,type,location,capacity,approval}=req.body||{};if(!name||!type||!location||!capacity||Number(capacity)<1)return res.status(400).json({error:"name, type, location and a valid capacity are required"});const row={id:uid(),name:String(name).trim(),type,location:String(location).trim(),capacity:parseInt(capacity,10),approval:approval?1:0};db.prepare("INSERT INTO resources (id,name,type,location,capacity,approval) VALUES (@id,@name,@type,@location,@capacity,@approval)").run(row);res.status(201).json(rowToResource(row))});
app.delete("/api/resources/:id",(req,res)=>{const info=db.prepare("DELETE FROM resources WHERE id=?").run(req.params.id);if(!info.changes)return res.status(404).json({error:"Resource not found"});res.status(204).end()});
app.get("/api/bookings",(req,res)=>res.json(db.prepare("SELECT * FROM bookings ORDER BY createdAt DESC").all().map(rowToBooking)));
app.get("/api/bookings/check-conflict",(req,res)=>{const {resourceId,date,start,end,excludeId}=req.query;if(!resourceId||!date||!start||!end)return res.status(400).json({error:"resourceId, date, start and end are required"});const conflict=findConflict(resourceId,date,start,end,excludeId);res.json({conflict:conflict?rowToBooking(conflict):null})});
app.post("/api/bookings",(req,res)=>{const {resourceId,userName,date,start,end,purpose}=req.body||{};if(!resourceId||!userName||!date||!start||!end||!purpose)return res.status(400).json({error:"resourceId, userName, date, start, end and purpose are required"});if(end<=start)return res.status(400).json({error:"End time must be after start time"});const resource=db.prepare("SELECT * FROM resources WHERE id=?").get(resourceId);if(!resource)return res.status(404).json({error:"Resource not found"});const conflict=findConflict(resourceId,date,start,end);if(conflict)return res.status(409).json({error:"That slot is already booked",conflict:rowToBooking(conflict)});const row={id:uid(),resourceId,userName:String(userName).trim(),date,start,end,purpose:String(purpose).trim(),status:resource.approval?"pending":"confirmed",createdAt:Date.now()};db.prepare("INSERT INTO bookings (id,resourceId,userName,date,start,end,purpose,status,createdAt) VALUES (@id,@resourceId,@userName,@date,@start,@end,@purpose,@status,@createdAt)").run(row);res.status(201).json(rowToBooking(row))});
function transitionBooking(req,res,{from,to}){const booking=db.prepare("SELECT * FROM bookings WHERE id=?").get(req.params.id);if(!booking)return res.status(404).json({error:"Booking not found"});if(from&&!from.includes(booking.status))return res.status(409).json({error:`Booking is '${booking.status}', expected one of: ${from.join(", ")}`});db.prepare("UPDATE bookings SET status=? WHERE id=?").run(to,booking.id);res.json(rowToBooking(db.prepare("SELECT * FROM bookings WHERE id=?").get(booking.id)))}
app.post("/api/bookings/:id/cancel",(req,res)=>transitionBooking(req,res,{from:["pending","confirmed"],to:"cancelled"}));
app.post("/api/bookings/:id/approve",(req,res)=>transitionBooking(req,res,{from:["pending"],to:"confirmed"}));
app.post("/api/bookings/:id/reject",(req,res)=>transitionBooking(req,res,{from:["pending"],to:"rejected"}));
app.post("/api/bookings/:id/complete",(req,res)=>transitionBooking(req,res,{from:["confirmed"],to:"completed"}));
app.get("/api/health",(req,res)=>res.json({ok:true}));
app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Bit Books server listening on port ${PORT}`));