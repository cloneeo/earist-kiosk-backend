import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { 
  AlertCircle, Loader2, Lock, Mail, 
  ArrowRight, ShieldCheck, ArrowLeft 
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "react-hot-toast";
import { motion } from "framer-motion";

export default function Login() {
  const { signIn, userRole, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [viewMode, setViewMode] = useState<"login" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "reset") {
      setViewMode("reset");
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setViewMode("reset");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "login") return;

    if (userRole && !authLoading) {
      if (userRole === "admin") {
        setLocation("/admin");
      } else if (userRole === "faculty") {
        setLocation("/faculty");
      }
    }
  }, [userRole, authLoading, setLocation, viewMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signIn(email, password);
      toast.success("Logged in successfully!");
    } catch (err: any) {
      const errorMessage = err.message || "Invalid login credentials";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    try {
      const redirectTo = `${window.location.origin}/login?mode=reset`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetError) throw resetError;

      toast.success("Password reset link sent. Check your email inbox.");
      setViewMode("login");
    } catch (err: any) {
      const message = err.message || "Failed to send reset link.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      toast.success("Password updated successfully. Please sign in.");
      await supabase.auth.signOut();
      setNewPassword("");
      setConfirmPassword("");
      setViewMode("login");
      setLocation("/login");
    } catch (err: any) {
      const message = err.message || "Failed to update password.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f3f1f6] p-4 font-sans">
      {/* Back to Kiosk Button */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-8 w-full max-w-md"
      >
        <button 
          onClick={() => setLocation("/kiosk")}
          className="flex items-center gap-2 text-[10px] font-black text-[#c62828]/65 hover:text-[#c62828] transition-colors uppercase tracking-[0.2em]"
        >
          <ArrowLeft size={14} /> Back to Kiosk
        </button>
      </motion.div>

      <div className="w-full max-w-md">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="border-0 shadow-[0_30px_60px_rgba(0,0,0,0.08)] bg-white rounded-[48px] overflow-hidden">
            {/* Top Branding Strip */}
            <div className="pt-14 pb-8 text-center border-t-[12px] border-[#c62828]">
              <div className="w-20 h-20 bg-[#fff5f5] text-[#c62828] rounded-[28px] flex items-center justify-center mx-auto mb-6 shadow-inner">
                <ShieldCheck size={40} />
              </div>
              <h1 className="text-4xl font-black text-[#c62828] tracking-tight uppercase">Staff Portal</h1>
              <p className="text-[#c62828]/65 font-bold text-[10px] uppercase tracking-[0.3em] mt-2 opacity-70">Authorized EARIST Personnel Only</p>
            </div>

            <CardContent className="px-10 pb-14">
              {viewMode === "login" && (
                <form onSubmit={handleSubmit} className="space-y-6">
                  {error && (
                    <Alert variant="destructive" className="bg-[#fff5f5] border-0 text-[#c62828] rounded-2xl p-4">
                      <AlertCircle className="h-5 w-5" />
                      <AlertDescription className="font-bold text-xs">{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest ml-2">Work Email</label>
                    <div className="relative group">
                      <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-[#c62828]/55 group-focus-within:text-[#c62828] transition-colors" size={20} />
                      <Input
                        type="email"
                        placeholder="name@earist.edu.ph"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={loading}
                        className="w-full pl-14 pr-8 py-8 bg-slate-50 border-slate-200 focus-visible:ring-4 focus-visible:ring-[#f1c4c4] focus-visible:border-[#c62828] rounded-[24px] font-bold text-slate-700 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest ml-2">Password</label>
                    <div className="relative group">
                      <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-[#c62828]/55 group-focus-within:text-[#c62828] transition-colors" size={20} />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={loading}
                        className="w-full pl-14 pr-8 py-8 bg-slate-50 border-slate-200 focus-visible:ring-4 focus-visible:ring-[#f1c4c4] focus-visible:border-[#c62828] rounded-[24px] font-bold text-slate-700 transition-all"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="text-[10px] font-black text-[#c62828]/65 hover:text-[#c62828] uppercase tracking-widest"
                      onClick={() => {
                        setError(null);
                        setViewMode("forgot");
                      }}
                    >
                      Forgot Password?
                    </button>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-[#c62828] hover:bg-[#b22222] text-white font-black tracking-[0.2em] uppercase rounded-[24px] h-16 mt-6 transition-all shadow-xl shadow-[#c62828]/20 flex items-center justify-center gap-3"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <>SIGN IN <ArrowRight size={20} /></>
                    )}
                  </Button>
                </form>
              )}

              {viewMode === "forgot" && (
                <form onSubmit={handleForgotPassword} className="space-y-6">
                  {error && (
                    <Alert variant="destructive" className="bg-[#fff5f5] border-0 text-[#c62828] rounded-2xl p-4">
                      <AlertCircle className="h-5 w-5" />
                      <AlertDescription className="font-bold text-xs">{error}</AlertDescription>
                    </Alert>
                  )}

                  <p className="text-sm font-bold text-slate-600">
                    Enter your faculty/admin email and we will send a secure password reset link.
                  </p>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest ml-2">Email</label>
                    <div className="relative group">
                      <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-[#c62828]/55 group-focus-within:text-[#c62828] transition-colors" size={20} />
                      <Input
                        type="email"
                        placeholder="name@earist.edu.ph"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={loading}
                        className="w-full pl-14 pr-8 py-8 bg-slate-50 border-slate-200 focus-visible:ring-4 focus-visible:ring-[#f1c4c4] focus-visible:border-[#c62828] rounded-[24px] font-bold text-slate-700 transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading}
                      className="rounded-[20px] h-14 font-black uppercase text-xs"
                      onClick={() => {
                        setError(null);
                        setViewMode("login");
                      }}
                    >
                      Back
                    </Button>
                    <Button
                      type="submit"
                      className="rounded-[20px] h-14 bg-[#c62828] hover:bg-[#b22222] text-white font-black uppercase text-xs"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send Link"}
                    </Button>
                  </div>
                </form>
              )}

              {viewMode === "reset" && (
                <form onSubmit={handleResetPassword} className="space-y-6">
                  {error && (
                    <Alert variant="destructive" className="bg-[#fff5f5] border-0 text-[#c62828] rounded-2xl p-4">
                      <AlertCircle className="h-5 w-5" />
                      <AlertDescription className="font-bold text-xs">{error}</AlertDescription>
                    </Alert>
                  )}

                  <p className="text-sm font-bold text-slate-600">
                    Set your new password. Use at least 8 characters.
                  </p>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest ml-2">New Password</label>
                    <div className="relative group">
                      <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-[#c62828]/55 group-focus-within:text-[#c62828] transition-colors" size={20} />
                      <Input
                        type="password"
                        placeholder="At least 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        disabled={loading}
                        className="w-full pl-14 pr-8 py-8 bg-slate-50 border-slate-200 focus-visible:ring-4 focus-visible:ring-[#f1c4c4] focus-visible:border-[#c62828] rounded-[24px] font-bold text-slate-700 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-[#c62828]/65 uppercase tracking-widest ml-2">Confirm Password</label>
                    <div className="relative group">
                      <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-[#c62828]/55 group-focus-within:text-[#c62828] transition-colors" size={20} />
                      <Input
                        type="password"
                        placeholder="Re-enter password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        disabled={loading}
                        className="w-full pl-14 pr-8 py-8 bg-slate-50 border-slate-200 focus-visible:ring-4 focus-visible:ring-[#f1c4c4] focus-visible:border-[#c62828] rounded-[24px] font-bold text-slate-700 transition-all"
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full rounded-[24px] h-16 bg-[#c62828] hover:bg-[#b22222] text-white font-black uppercase tracking-[0.2em]"
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : "Update Password"}
                  </Button>
                </form>
              )}

              <div className="mt-10 pt-8 border-t border-slate-50 text-center">
                <p className="text-[10px] font-black text-[#c62828]/60 uppercase tracking-widest">
                  Password reset is available directly from this portal
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
