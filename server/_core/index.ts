import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import os from "os";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerChatRoutes } from "./chat";
import { registerAdminRoutes } from "./adminRoutes";
import { registerBookingEmailRoutes } from "./bookingEmail";
import { registerConsultationRecordingRoutes } from "./consultationRecording";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  registerOAuthRoutes(app);
  registerChatRoutes(app);
  registerAdminRoutes(app);
  registerBookingEmailRoutes(app);
  registerConsultationRecordingRoutes(app);
  
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const host = String(process.env.HOST || "0.0.0.0").trim() || "0.0.0.0";
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, host, () => {
    const networkUrls = Object.values(os.networkInterfaces())
      .flat()
      .filter((address): address is NonNullable<typeof address> => !!address)
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => `http://${address.address}:${port}/`);

    console.log(`Server running on http://localhost:${port}/`);
    if (host === "0.0.0.0" && networkUrls.length > 0) {
      console.log("LAN URLs:");
      for (const url of networkUrls) {
        console.log(`  ${url}`);
      }
    }
  });
}

startServer().catch(console.error);
