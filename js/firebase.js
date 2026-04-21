import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAnMI7QXQJkckdb8Oni_Sjol9z8vyL1WPQ",
  authDomain: "ipl-game-b5ab6.firebaseapp.com",
  projectId: "ipl-game-b5ab6",
  storageBucket: "ipl-game-b5ab6.firebasestorage.app",
  messagingSenderId: "310608517860",
  appId: "1:310608517860:web:33923f44458023aa0c2af1"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function randomRoomCode(length = 6){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let output = "";
  for(let i = 0; i < length; i++){
    output += chars[Math.floor(Math.random() * chars.length)];
  }
  return output;
}

function cleanRoomCode(value){
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function watchGuestAuth(callback){
  return onAuthStateChanged(auth, callback);
}

export async function ensureGuestSession(){
  if(auth.currentUser){
    try{
      await auth.currentUser.getIdToken(true);
      return auth.currentUser;
    }catch(err){
      await signOut(auth).catch(()=>{});
    }
  }
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export function getCurrentGuestUser(){
  return auth.currentUser;
}

export async function createRoom({ hostName, settings }){
  const user = await ensureGuestSession();
  const safeHostName = String(hostName || "Host").trim() || "Host";
  for(let attempt = 0; attempt < 8; attempt++){
    const roomId = randomRoomCode(6);
    const roomRef = doc(db, "rooms", roomId);
    const existing = await getDoc(roomRef);
    if(existing.exists()) continue;
    await setDoc(roomRef, {
      roomId,
      status: "lobby",
      hostUid: user.uid,
      hostName: safeHostName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      settings: settings || {},
      members: [{
        uid: user.uid,
        name: safeHostName,
        joinedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        isHost: true
      }]
    });
    return roomId;
  }
  throw new Error("Could not generate a unique room code. Try again.");
}

export async function joinRoom(roomId, playerName){
  const user = await ensureGuestSession();
  const safeRoomId = cleanRoomCode(roomId);
  if(!safeRoomId) throw new Error("Enter a valid room code.");
  const safePlayerName = String(playerName || "Player").trim() || "Player";
  const roomRef = doc(db, "rooms", safeRoomId);
  await runTransaction(db, async (transaction)=>{
    const snap = await transaction.get(roomRef);
    if(!snap.exists()) throw new Error("Room not found.");
    const data = snap.data() || {};
    const members = Array.isArray(data.members) ? data.members.slice() : [];
    const existingIdx = members.findIndex(member => member && member.uid === user.uid);
    const nextMember = {
      uid: user.uid,
      name: safePlayerName,
      joinedAt: existingIdx >= 0 ? (members[existingIdx].joinedAt || new Date().toISOString()) : new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      isHost: data.hostUid === user.uid
    };
    if(existingIdx >= 0) members[existingIdx] = nextMember;
    else members.push(nextMember);
    transaction.update(roomRef, {
      members,
      updatedAt: serverTimestamp()
    });
  });
  return safeRoomId;
}

export async function updateRoomPresence(roomId, playerName){
  const user = await ensureGuestSession();
  const safeRoomId = cleanRoomCode(roomId);
  if(!safeRoomId) throw new Error("Missing room code.");
  const roomRef = doc(db, "rooms", safeRoomId);
  await runTransaction(db, async (transaction)=>{
    const snap = await transaction.get(roomRef);
    if(!snap.exists()) throw new Error("Room not found.");
    const data = snap.data() || {};
    const members = Array.isArray(data.members) ? data.members.slice() : [];
    const idx = members.findIndex(member => member && member.uid === user.uid);
    const safeName = String(playerName || (idx >= 0 ? members[idx].name : "Player")).trim() || "Player";
    const nextMember = {
      uid: user.uid,
      name: safeName,
      joinedAt: idx >= 0 ? (members[idx].joinedAt || new Date().toISOString()) : new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      isHost: data.hostUid === user.uid
    };
    if(idx >= 0) members[idx] = nextMember;
    else members.push(nextMember);
    transaction.update(roomRef, { members, updatedAt: serverTimestamp() });
  });
}

export async function transferRoomHost(roomId, targetUid){
  const user = await ensureGuestSession();
  const safeRoomId = cleanRoomCode(roomId);
  if(!safeRoomId) throw new Error("Missing room code.");
  const roomRef = doc(db, "rooms", safeRoomId);
  await runTransaction(db, async (transaction)=>{
    const snap = await transaction.get(roomRef);
    if(!snap.exists()) throw new Error("Room not found.");
    const data = snap.data() || {};
    if(data.hostUid !== user.uid) throw new Error("Only the host can transfer host.");
    const members = Array.isArray(data.members) ? data.members.map(member=>({
      ...member,
      isHost: member && member.uid === targetUid
    })) : [];
    const target = members.find(member=>member && member.uid === targetUid);
    if(!target) throw new Error("Target player is not in this room.");
    transaction.update(roomRef, {
      hostUid: targetUid,
      hostName: target.name || "Host",
      members,
      updatedAt: serverTimestamp()
    });
  });
}

export async function sendRoomChatMessage(roomId, message){
  const user = await ensureGuestSession();
  const safeRoomId = cleanRoomCode(roomId);
  if(!safeRoomId) throw new Error("Missing room code.");
  const text = String(message || "").trim().slice(0, 160);
  if(!text) return;
  const roomRef = doc(db, "rooms", safeRoomId);
  await runTransaction(db, async (transaction)=>{
    const snap = await transaction.get(roomRef);
    if(!snap.exists()) throw new Error("Room not found.");
    const data = snap.data() || {};
    const members = Array.isArray(data.members) ? data.members : [];
    const member = members.find(item=>item && item.uid === user.uid);
    const chatMessages = Array.isArray(data.chatMessages) ? data.chatMessages.slice(-39) : [];
    chatMessages.push({
      uid: user.uid,
      name: member && member.name ? member.name : "Player",
      text,
      at: new Date().toISOString()
    });
    transaction.update(roomRef, { chatMessages, updatedAt: serverTimestamp() });
  });
}

export async function updateRoomSettings(roomId, settings){
  const safeRoomId = cleanRoomCode(roomId);
  if(!safeRoomId) throw new Error("Missing room code.");
  await updateDoc(doc(db, "rooms", safeRoomId), {
    settings: settings || {},
    updatedAt: serverTimestamp()
  });
}

export async function updateRoomGameState(roomId, gameState){
  const safeRoomId = cleanRoomCode(roomId);
  if(!safeRoomId) throw new Error("Missing room code.");
  await updateDoc(doc(db, "rooms", safeRoomId), {
    gameState: gameState || null,
    updatedAt: serverTimestamp()
  });
}

export function subscribeToRoom(roomId, callback){
  const safeRoomId = cleanRoomCode(roomId);
  if(!safeRoomId) throw new Error("Missing room code.");
  return onSnapshot(doc(db, "rooms", safeRoomId), (snapshot)=>{
    callback(snapshot.exists() ? snapshot.data() : null);
  });
}
