// src/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const saved = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
const startLng = saved || "en";

export const resources = {
  en: { translation: {
    "Dashboard":"Dashboard","Pulse":"Pulse","Hubs":"Hubs","Schedule":"Schedule",
    "Stacks":"Stacks","Desk":"Desk","Stories":"Stories","Friends":"Friends",
    "Profile":"Profile","Menu":"Menu","View all":"View all","No friends yet.":"No friends yet.",
    "Loading…":"Loading…","Sign in to see friends.":"Sign in to see friends.",
    "Message":"Message","Online":"Online","Offline":"Offline",
    "Light Mode":"Light Mode","Night Mode":"Night Mode","Logout":"Logout",
    "Now Playing":"Now Playing","Open on YouTube":"Open on YouTube"
  }},
  th: { translation: {
    "Dashboard":"แดชบอร์ด","Pulse":"ฟีด","Hubs":"ฮับ","Schedule":"ตาราง",
    "Stacks":"บันทึก","Desk":"โต๊ะทำงาน","Stories":"สตอรี่","Friends":"เพื่อน",
    "Profile":"โปรไฟล์","Menu":"เมนู","View all":"ดูทั้งหมด","No friends yet.":"ยังไม่มีเพื่อน",
    "Loading…":"กำลังโหลด…","Sign in to see friends.":"ลงชื่อเข้าใช้เพื่อดูเพื่อน",
    "Message":"ข้อความ","Online":"ออนไลน์","Offline":"ออฟไลน์",
    "Light Mode":"โหมดสว่าง","Night Mode":"โหมดมืด","Logout":"ออกจากระบบ",
    "Now Playing":"กำลังเล่น","Open on YouTube":"เปิดใน YouTube"
  }},
};

i18n.use(initReactI18next).init({
  resources,
  lng: startLng,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  keySeparator: false, // keys are literal phrases
});

export default i18n;
