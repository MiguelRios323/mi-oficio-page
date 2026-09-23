import {
  cert,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";

import {
  getAuth,
  type Auth,
} from "firebase-admin/auth";

import {
  getDatabase,
  type Database,
} from "firebase-admin/database";

let firebaseAdminApp: App | undefined;

function getFirebaseAdminApp(): App {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  const apps = getApps();

  if (apps.length > 0) {
    firebaseAdminApp = apps[0];
    return firebaseAdminApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();

  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    .trim();

  const databaseURL =
    process.env.FIREBASE_DATABASE_URL?.trim();

  if (!projectId) {
    throw new Error("Falta FIREBASE_PROJECT_ID.");
  }

  if (!clientEmail) {
    throw new Error("Falta FIREBASE_CLIENT_EMAIL.");
  }

  if (!privateKey) {
    throw new Error("Falta FIREBASE_PRIVATE_KEY.");
  }

  if (!databaseURL) {
    throw new Error("Falta FIREBASE_DATABASE_URL.");
  }

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY no contiene una clave privada válida."
    );
  }

  firebaseAdminApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    databaseURL,
  });

  return firebaseAdminApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getFirebaseAdminApp());
}

export function getAdminDb(): Database {
  return getDatabase(getFirebaseAdminApp());
}