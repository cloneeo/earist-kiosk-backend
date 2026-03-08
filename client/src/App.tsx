import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ActiveTicketNotifier from "./components/ActiveTicketNotifier";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import StudentKiosk from "./pages/StudentKiosk";
import QueueBooking from "./pages/QueueBooking";
import QueueConfirmation from "./pages/QueueConfirmation";
import StudentStatus from "./pages/StudentStatus";
import KioskQueueMonitor from "./pages/KioskQueueMonitor";
import KioskScheduleDirectory from "./pages/KioskScheduleDirectory";
import FacultyDashboard from "./pages/FacultyDashboard";
import AdminDashboard from "./pages/AdminDashboard";

// Helper component for role-based access
const ProtectedRoute = ({ 
  component: Component, 
  allowedRoles 
}: { 
  component: React.ComponentType<any>, 
  allowedRoles: ("admin" | "faculty" | "student")[] 
}) => {
  const { user, userRole } = useAuth();

  // If no user is found, redirect to login
  if (!user) return <Redirect to="/login" />;

  // Redirect if role is not authorized
  if (userRole && !allowedRoles.includes(userRole as any)) {
    if (userRole === "admin") return <Redirect to="/admin" />;
    if (userRole === "faculty") return <Redirect to="/faculty" />;
    return <Redirect to="/kiosk" />;
  }

  return <Component />;
};

function Router() {
  const { user, userRole } = useAuth();

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/kiosk" component={StudentKiosk} />
      <Route path="/kiosk/booking" component={QueueBooking} />
      <Route path="/kiosk/confirmation" component={QueueConfirmation} />
      <Route path="/status/:queueId" component={StudentStatus} />
      <Route path="/kiosk/monitor" component={KioskQueueMonitor} />
      <Route path="/kiosk/schedules" component={KioskScheduleDirectory} />

      <Route path="/login">
        {user ? (
          userRole === "admin" ? <Redirect to="/admin" /> :
          userRole === "faculty" ? <Redirect to="/faculty" /> : 
          userRole === "student" ? <Redirect to="/kiosk" /> :
          <Login />
        ) : (
          <Login />
        )}
      </Route>

      {/* Protected Routes */}
      <Route path="/faculty">
        <ProtectedRoute component={FacultyDashboard} allowedRoles={["faculty", "admin"]} />
      </Route>

      <Route path="/admin">
        <ProtectedRoute component={AdminDashboard} allowedRoles={["admin"]} />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <TooltipProvider>
            <ActiveTicketNotifier />
            <Toaster 
              position="top-center" 
              richColors 
              toastOptions={{
                style: { borderRadius: '24px', fontWeight: '900', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.1em' }
              }} 
            />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
