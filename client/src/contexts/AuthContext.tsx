import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  userRole: "admin" | "faculty" | "student" | null;
  loading: boolean;
  error: Error | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
type AppRole = "admin" | "faculty" | "student" | null;

const ADMIN_EMAILS = new Set(["admin@earist.edu.ph", "adminj@earist.edu.ph"]);

const normalizeEmail = (email?: string) => (email || "").trim().toLowerCase();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<"admin" | "faculty" | "student" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const roleRef = useRef<AppRole>(null);

  useEffect(() => {
    roleRef.current = userRole;
  }, [userRole]);

  // --- ROLE DETECTION LOGIC ---
  const getUserRole = async (userId: string, email?: string, preferredRole: AppRole = null): Promise<Exclude<AppRole, null>> => {
    try {
      // 1. Hardcoded admin check.
      if (ADMIN_EMAILS.has(normalizeEmail(email))) {
        return "admin";
      }

      // 2. Profile table role check.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      if (!profileError && profile?.role) {
        return profile.role as Exclude<AppRole, null>;
      }

      // 3. Secondary faculty check.
      const { data: facultyData, error: facultyError } = await supabase
        .from("faculty")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (facultyError) {
        if (preferredRole === "admin" || preferredRole === "faculty") return preferredRole;
        return "student";
      }

      return facultyData ? "faculty" : "student";
    } catch (err) {
      console.error("Role verification failed:", err);
      if (preferredRole === "admin" || preferredRole === "faculty") return preferredRole;
      return "student";
    }
  };

  const resolveUserRole = async (userId: string, email?: string, preferredRole: AppRole = null): Promise<AppRole> => {
    try {
      const role = await Promise.race<AppRole>([
        getUserRole(userId, email, preferredRole),
        new Promise<AppRole>((resolve) => setTimeout(() => resolve(preferredRole), 4000)),
      ]);
      return role ?? preferredRole;
    } catch (err) {
      console.error("Role resolve failed:", err);
      return preferredRole;
    }
  };

  useEffect(() => {
    // FAIL-SAFE: force stop loading if auth initialization hangs.
    const timeout = setTimeout(() => {
      setLoading(false);
      console.warn("Auth initialization timed out.");
    }, 7000);

    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          setUser(session.user);
          setLoading(false); // unblock UI immediately
          const role = await resolveUserRole(session.user.id, session.user.email, roleRef.current);
          if (role) setUserRole(role);
        } else {
          // No session found, clear state
          setUser(null);
          setUserRole(null);
          setLoading(false);
        }
      } catch (err) {
        console.error("Auth init error:", err);
        setError(err instanceof Error ? err : new Error("Auth failed"));
        setLoading(false);
      } finally {
        clearTimeout(timeout);
      }
    };

    initializeAuth();

    // LISTEN FOR AUTH CHANGES (Login/Logout events)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        setLoading(false);

        // Avoid unnecessary role churn on token refresh.
        if (event === "TOKEN_REFRESHED" && roleRef.current) return;

        const role = await resolveUserRole(session.user.id, session.user.email, roleRef.current);
        if (role) setUserRole(role);
      } else {
        setUser(null);
        setUserRole(null);
        setLoading(false);
      }
    });

    return () => {
      subscription?.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      setError(null);
      setLoading(true);
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
    } catch (err) {
      setLoading(false);
      throw err instanceof Error ? err : new Error("Login failed");
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      await supabase.auth.signOut();
      setUser(null);
      setUserRole(null);
      // Clear local storage to fix "ghost sessions"
      localStorage.removeItem('supabase.auth.token'); 
    } catch (err) {
      console.error("Sign out failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, userRole, loading, error, signIn, signOut, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
