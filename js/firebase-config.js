import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc,
  setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  onSnapshot, query, orderBy, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBRlS7SFaiQxmk5CaqzH3F-3i0nPMR7mp4",
  authDomain: "super-acao2026.firebaseapp.com",
  projectId: "super-acao2026",
  storageBucket: "super-acao2026.firebasestorage.app",
  messagingSenderId: "353312397149",
  appId: "1:353312397149:web:bfe634ed564f4f5fab3ab4"
};

export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);
export {
  collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  onSnapshot, query, orderBy, where, writeBatch
};
