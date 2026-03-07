import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, Building2, Clock, LayoutDashboard, LogOut, Plus, Trash2, UserCheck, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase";
import { toast } from "react-hot-toast";

type College = Database["public"]["Tables"]["colleges"]["Row"];
type Department = Database["public"]["Tables"]["departments"]["Row"];
type Faculty = Database["public"]["Tables"]["faculty"]["Row"];
type AdminTable = "colleges" | "departments" | "faculty";

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { signOut, userRole } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"consultations" | "colleges" | "departments" | "faculty">("consultations");

  const [colleges, setColleges] = useState<College[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [liveQueue, setLiveQueue] = useState<any[]>([]);

  // Modal States
  const [isCollegeModalOpen, setIsCollegeModalOpen] = useState(false);
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [isFacultyModalOpen, setIsFacultyModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Input States
  const [newCollege, setNewCollege] = useState({ name: "", code: "" });
  const [newDept, setNewDept] = useState({ name: "", code: "", college_id: "" });
  const [newFaculty, setNewFaculty] = useState({ name: "", email: "", department_id: "" });

  const stats = {
    waiting: liveQueue.filter((t) => t.status === "waiting").length,
    inSession: liveQueue.filter((t) => t.status === "called").length,
    total: liveQueue.length,
  };

  useEffect(() => {
    if (userRole && userRole !== "admin") setLocation("/");
  }, [setLocation, userRole]);

  const loadData = async () => {
    try {
      const [collegesRes, departmentsRes, facultiesRes, queueRes] = await Promise.all([
        supabase.from("colleges").select("*").order("name"),
        supabase.from("departments").select("*").order("name"),
        supabase.from("faculty").select("*").order("name"),
        supabase.from("queue_entries").select("*, faculty:faculty_id(name)").in("status", ["waiting", "called"]).order("created_at", { ascending: true }),
      ]);

      if (collegesRes.error) throw collegesRes.error;
      if (departmentsRes.error) throw departmentsRes.error;
      if (facultiesRes.error) throw facultiesRes.error;
      if (queueRes.error) throw queueRes.error;

      setColleges(collegesRes.data || []);
      setDepartments(departmentsRes.data || []);
      setFaculties(facultiesRes.data || []);
      setLiveQueue(queueRes.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const channel = supabase.channel("admin-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "faculty" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "colleges" }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleAddCollege = async () => {
    if (!newCollege.name || !newCollege.code) return toast.error("Fill in all fields");
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("colleges").insert({ name: newCollege.name, code: newCollege.code.toUpperCase() });
      if (error) throw error;
      toast.success("College added");
      setIsCollegeModalOpen(false);
      setNewCollege({ name: "", code: "" });
      loadData();
    } catch (err: any) { toast.error(err.message); } finally { setIsSubmitting(false); }
  };

  const handleAddDepartment = async () => {
    if (!newDept.name || !newDept.code || !newDept.college_id) return toast.error("Fill in all fields");
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("departments").insert({ name: newDept.name, code: newDept.code.toUpperCase(), college_id: newDept.college_id });
      if (error) throw error;
      toast.success("Department added");
      setIsDeptModalOpen(false);
      setNewDept({ name: "", code: "", college_id: "" });
      loadData();
    } catch (err: any) { toast.error(err.message); } finally { setIsSubmitting(false); }
  };

  const handleAddFaculty = async () => {
    if (!newFaculty.name || !newFaculty.email || !newFaculty.department_id) return toast.error("Fill in all fields");
    setIsSubmitting(true);
    try {
      const passwordChars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$";
      const tempPassword = Array.from({ length: 12 }, () => passwordChars[Math.floor(Math.random() * passwordChars.length)]).join("");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) throw new Error("Missing Supabase environment variables");

      // Use isolated auth client so admin session is not replaced by new faculty session.
      const signupClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      const { data: signUpData, error: signUpError } = await signupClient.auth.signUp({
        email: newFaculty.email.trim(),
        password: tempPassword,
      });
      if (signUpError) throw signUpError;
      if (!signUpData.user?.id) throw new Error("Auth user was not created");

      const { error } = await supabase.from("faculty").insert({
        user_id: signUpData.user.id,
        name: newFaculty.name.trim(),
        email: newFaculty.email.trim(),
        department_id: newFaculty.department_id,
        status: "offline",
      });
      if (error) throw error;

      toast.success("Faculty member added");
      setIsFacultyModalOpen(false);
      setNewFaculty({ name: "", email: "", department_id: "" });
      alert(`Faculty account created.\nEmail: ${signUpData.user.email}\nTemporary Password: ${tempPassword}`);
      loadData();
    } catch (err: any) { toast.error(err.message); } finally { setIsSubmitting(false); }
  };

  const handleDelete = async (table: AdminTable, id: string) => {
    if (!confirm("Confirm deletion?")) return;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Session expired. Please sign in again.");
      }

      const response = await fetch("/api/admin/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ table, id }),
      });

      const payload = await response
        .json()
        .catch(() => ({ error: "Delete request failed." }));

      if (!response.ok) {
        throw new Error(payload?.error || "Delete failed");
      }

      toast.success("Deleted successfully");
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#FFFCEF] overflow-hidden font-sans">
      <nav className="bg-white border-b border-[#659BB9] px-8 py-4 flex justify-between items-center shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="bg-[#659BB9] p-2 rounded-lg text-white"><LayoutDashboard className="w-5 h-5" /></div>
          <h1 className="text-xl font-extrabold text-[#659BB9] tracking-tight uppercase">Admin Portal</h1>
        </div>
        <Button variant="ghost" onClick={() => signOut()} className="text-[#659BB9]/60 hover:text-[#659BB9] font-bold uppercase text-[10px] tracking-widest">
          <LogOut className="mr-2 h-4 w-4" /> Sign Out
        </Button>
      </nav>

      <div className="flex-1 overflow-auto p-8 lg:p-12">
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-black text-[#659BB9] tracking-tighter uppercase">Queue Monitor</h2>
            <div className="flex gap-4">
              <div className="bg-white px-6 py-4 rounded-2xl border border-slate-100"><p className="text-[10px] font-black uppercase text-[#659BB9]/60">In Session</p><p className="text-2xl font-black text-[#659BB9]">{stats.inSession}</p></div>
              <div className="bg-white px-6 py-4 rounded-2xl border border-slate-100"><p className="text-[10px] font-black uppercase text-[#659BB9]/60">Waiting</p><p className="text-2xl font-black text-[#659BB9]">{stats.waiting}</p></div>
              <div className="bg-[#659BB9] px-6 py-4 rounded-2xl text-white"><p className="text-[10px] font-black uppercase opacity-70">Total</p><p className="text-2xl font-black">{stats.total}</p></div>
            </div>
          </div>

          <div className="flex gap-2 bg-white p-1.5 rounded-2xl border border-slate-100">
            {[
              { id: "consultations", label: "Live Queue", icon: LayoutDashboard },
              { id: "colleges", label: "Colleges", icon: Building2 },
              { id: "departments", label: "Depts", icon: Building2 },
              { id: "faculty", label: "Faculty", icon: Users },
            ].map((tab) => (
              <Button key={tab.id} variant={activeTab === tab.id ? "default" : "ghost"} className={activeTab === tab.id ? "bg-[#659BB9] hover:bg-[#659BB9] text-white rounded-xl" : "rounded-xl text-[#659BB9]/70"} onClick={() => setActiveTab(tab.id as any)}>
                <tab.icon className="w-4 h-4 mr-2" /> {tab.label}
              </Button>
            ))}
          </div>
        </div>

        {activeTab === "consultations" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {liveQueue.map((ticket) => (
              <Card key={ticket.id} className="rounded-3xl border-0 shadow-sm">
                <CardContent className="p-6 space-y-5">
                  <div className="flex justify-between">
                    <Badge className={ticket.status === "called" ? "bg-[#659BB9]/30 text-[#659BB9]" : "bg-[#659BB9]/30 text-[#659BB9]"}>{ticket.status === "called" ? "IN SESSION" : "WAITING"}</Badge>
                    <div className="flex items-center gap-1 text-[#659BB9]/60 text-xs font-bold"><Clock size={12} />{new Date(ticket.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                  <p className="text-3xl font-black text-[#659BB9]">{ticket.student_number}</p>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3"><UserCheck className="w-5 h-5 text-[#659BB9]" /><div><p className="text-[10px] font-black text-[#659BB9]/60 uppercase">Professor</p><p className="text-sm font-bold text-[#659BB9]/85">{ticket.faculty?.name || "Assigning..."}</p></div></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="rounded-3xl border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between border-b px-8 py-6">
              <CardTitle className="uppercase text-xs font-black text-[#659BB9]">{activeTab} Registry</CardTitle>
              {/* FIXED ADD BUTTON FOR ALL TABS */}
              <Button 
                className="bg-[#659BB9] hover:bg-[#659BB9] text-white text-xs font-bold px-6 rounded-xl shadow-md transition-all" 
                onClick={() => {
                  if (activeTab === "colleges") setIsCollegeModalOpen(true);
                  else if (activeTab === "departments") setIsDeptModalOpen(true);
                  else if (activeTab === "faculty") setIsFacultyModalOpen(true);
                }}
                disabled={activeTab === "departments" && colleges.length === 0 || activeTab === "faculty" && departments.length === 0}
              >
                <Plus className="w-4 h-4 mr-2" /> Add {activeTab === "faculty" ? "Faculty" : activeTab.slice(0, -1)}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
               {activeTab === "colleges" && (
                 <table className="w-full text-sm">
                   <thead className="bg-slate-50"><tr><th className="text-left p-4">Name</th><th className="text-left p-4">Code</th><th className="text-right p-4">Actions</th></tr></thead>
                   <tbody>{colleges.map(c => (<tr key={c.id} className="border-t"><td className="p-4 font-bold">{c.name}</td><td className="p-4 font-mono">{c.code}</td><td className="p-4 text-right"><Button variant="ghost" size="icon" onClick={() => handleDelete("colleges", c.id)}><Trash2 className="h-4 w-4 text-[#659BB9]" /></Button></td></tr>))}</tbody>
                 </table>
               )}
               {activeTab === "departments" && (
                 <table className="w-full text-sm">
                   <thead className="bg-slate-50"><tr><th className="text-left p-4">Name</th><th className="text-left p-4">Code</th><th className="text-left p-4">College</th><th className="text-right p-4">Actions</th></tr></thead>
                   <tbody>{departments.map(d => (<tr key={d.id} className="border-t"><td className="p-4 font-bold">{d.name}</td><td className="p-4 font-mono">{d.code}</td><td className="p-4">{colleges.find(c => c.id === d.college_id)?.name}</td><td className="p-4 text-right"><Button variant="ghost" size="icon" onClick={() => handleDelete("departments", d.id)}><Trash2 className="h-4 w-4 text-[#659BB9]" /></Button></td></tr>))}</tbody>
                 </table>
               )}
               {activeTab === "faculty" && (
                 <table className="w-full text-sm">
                   <thead className="bg-slate-50"><tr><th className="text-left p-4">Name</th><th className="text-left p-4">Email</th><th className="text-left p-4">Department</th><th className="text-right p-4">Actions</th></tr></thead>
                   <tbody>{faculties.map(f => (<tr key={f.id} className="border-t"><td className="p-4 font-bold">{f.name}</td><td className="p-4">{f.email}</td><td className="p-4">{departments.find(d => d.id === f.department_id)?.name}</td><td className="p-4 text-right"><Button variant="ghost" size="icon" onClick={() => handleDelete("faculty", f.id)}><Trash2 className="h-4 w-4 text-[#659BB9]" /></Button></td></tr>))}</tbody>
                 </table>
               )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* MODALS */}
      <Dialog open={isCollegeModalOpen} onOpenChange={setIsCollegeModalOpen}>
        <DialogContent><DialogHeader><DialogTitle>Add College</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="College Name" value={newCollege.name} onChange={e => setNewCollege(p => ({...p, name: e.target.value}))}/>
            <Input placeholder="Code" value={newCollege.code} onChange={e => setNewCollege(p => ({...p, code: e.target.value.toUpperCase()}))} className="font-mono"/>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsCollegeModalOpen(false)}>Cancel</Button><Button onClick={handleAddCollege} disabled={isSubmitting} className="bg-[#659BB9] text-white">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeptModalOpen} onOpenChange={setIsDeptModalOpen}>
        <DialogContent><DialogHeader><DialogTitle>Add Department</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Dept Name" value={newDept.name} onChange={e => setNewDept(p => ({...p, name: e.target.value}))}/>
            <Input placeholder="Code" value={newDept.code} onChange={e => setNewDept(p => ({...p, code: e.target.value.toUpperCase()}))} className="font-mono"/>
            <Select value={newDept.college_id} onValueChange={v => setNewDept(p => ({...p, college_id: v}))}><SelectTrigger><SelectValue placeholder="Select College"/></SelectTrigger><SelectContent>{colleges.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsDeptModalOpen(false)}>Cancel</Button><Button onClick={handleAddDepartment} disabled={isSubmitting} className="bg-[#659BB9] text-white">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isFacultyModalOpen} onOpenChange={setIsFacultyModalOpen}>
        <DialogContent><DialogHeader><DialogTitle>Add Faculty</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Full Name" value={newFaculty.name} onChange={e => setNewFaculty(p => ({...p, name: e.target.value}))}/>
            <Input placeholder="Email" value={newFaculty.email} onChange={e => setNewFaculty(p => ({...p, email: e.target.value}))}/>
            <p className="text-xs text-[#659BB9]/70">A temporary password will be generated automatically after saving.</p>
            <Select value={newFaculty.department_id} onValueChange={v => setNewFaculty(p => ({...p, department_id: v}))}><SelectTrigger><SelectValue placeholder="Select Dept"/></SelectTrigger><SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsFacultyModalOpen(false)}>Cancel</Button><Button onClick={handleAddFaculty} disabled={isSubmitting} className="bg-[#659BB9] text-white">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
