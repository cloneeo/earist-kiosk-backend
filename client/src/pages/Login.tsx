import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userRole && !authLoading) {
      if (userRole === "admin") {
        setLocation("/admin");
      } else if (userRole === "faculty") {
        setLocation("/faculty");
      }
    }
  }, [userRole, authLoading, setLocation]);

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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#EBEBEB] p-4 font-sans">
      {/* Back to Kiosk Button */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-8 w-full max-w-md"
      >
        <button 
          onClick={() => setLocation("/kiosk")}
          className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-[#10367D] transition-colors uppercase tracking-[0.2em]"
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
            <div className="pt-14 pb-8 text-center border-t-[12px] border-[#10367D]">
              <div className="w-20 h-20 bg-[#A5CEE0]/30 text-[#10367D] rounded-[28px] flex items-center justify-center mx-auto mb-6 shadow-inner">
                <ShieldCheck size={40} />
              </div>
              <h1 className="text-4xl font-black text-slate-900 tracking-tight uppercase">Staff Portal</h1>
              <p className="text-slate-400 font-bold text-[10px] uppercase tracking-[0.3em] mt-2 opacity-60">Authorized EARIST Personnel Only</p>
            </div>

            <CardContent className="px-10 pb-14">
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <Alert variant="destructive" className="bg-[#A5CEE0]/30 border-0 text-[#10367D] rounded-2xl p-4">
                    <AlertCircle className="h-5 w-5" />
                    <AlertDescription className="font-bold text-xs">{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Work Email</label>
                  <div className="relative group">
                    <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#10367D] transition-colors" size={20} />
                    <Input
                      type="email"
                      placeholder="name@earist.edu.ph"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={loading}
                      className="w-full pl-14 pr-8 py-8 bg-slate-50 border-transparent focus-visible:ring-4 focus-visible:ring-[#A5CEE0] focus-visible:border-[#10367D] rounded-[24px] font-bold text-slate-700 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Password</label>
                  <div className="relative group">
                    <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-[#10367D] transition-colors" size={20} />
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                      className="w-full pl-14 pr-8 py-8 bg-slate-50 border-transparent focus-visible:ring-4 focus-visible:ring-[#A5CEE0] focus-visible:border-[#10367D] rounded-[24px] font-bold text-slate-700 transition-all"
                    />
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full bg-[#10367D] hover:bg-[#10367D] text-white font-black tracking-[0.2em] uppercase rounded-[24px] h-16 mt-6 transition-all shadow-xl shadow-[#10367D]/20 flex items-center justify-center gap-3" 
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <>SIGN IN <ArrowRight size={20} /></>
                  )}
                </Button>
              </form>

              <div className="mt-10 pt-8 border-t border-slate-50 text-center">
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                  Forgot password? Contact EARIST IT Support
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
