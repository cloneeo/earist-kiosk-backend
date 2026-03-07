// src/components/ConsultationList.tsx

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CalendarDays, MessageSquareText, PlusCircle } from "lucide-react";

// mock data structure
const consultations = [
  {
    id: 1,
    title: "Project Thesis Defense Preparation",
    facultyName: "Dr. Maria Cruz",
    studentName: "John Doe",
    priority: "URGENT",
    status: "In Progress",
    date: "September, 17",
    studentPhoto: "https://github.com/shadcn.png"
  },
  {
    id: 2,
    title: "DSP Lab Report Consultation",
    facultyName: "Engr. David Reyes",
    studentName: "Jane Smith",
    priority: "MODERATE PRIORITY",
    status: "In Correction",
    date: "September, 17",
    studentPhoto: "https://github.com/shadcn.png"
  }
];

// Helper to get priority color based on name
const getPriorityStyles = (priority: string) => {
  switch (priority) {
    case "URGENT": return "border-[#024059] text-[#024059] bg-[#E8E6EB]/60";
    case "MODERATE PRIORITY": return "border-orange-500 text-orange-700 bg-orange-50";
    default: return "border-[#024059] text-[#024059] bg-[#E8E6EB]/60";
  }
};

export default function ConsultationList() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-[#E8E6EB]/35 p-6">
      
      {/* Header and Add Button */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-[#E8E6EB]">
        <h1 className="text-3xl font-bold text-[#024059]">Queue & Consultations</h1>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#024059] hover:bg-[#024059] text-white transition-colors">
          <PlusCircle className="w-5 h-5" />
          Add New Queue
        </button>
      </div>

      {/* Grid of cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {consultations.map((consult) => {
          const priorityStyles = getPriorityStyles(consult.priority);
          
          return (
            <Card key={consult.id} className="relative w-full shadow-md border-slate-100 hover:border-[#E8E6EB] transition-all">
              
              {/* Colored Priority Banner (Top Indicator) */}
              <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-lg ${priorityStyles.split(' ')[0].replace('border','bg')}`}></div>

              <CardHeader className="pt-6 pb-2">
                
                {/* Priority Badge */}
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className={`font-bold text-[10px] px-2 py-0.5 rounded-sm ${priorityStyles}`}>
                    {consult.priority}
                  </Badge>
                </div>

                {/* Consultation Title */}
                <CardTitle className="text-lg font-semibold text-slate-900 leading-tight">
                  {consult.title}
                </CardTitle>
                
                {/* Faculty Name */}
                <p className="text-xs text-[#024059] mt-1">Faculty: {consult.facultyName}</p>
              </CardHeader>

              <CardContent className="space-y-4">
                
                {/* Avatar and Status */}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex -space-x-3">
                    <Avatar className="w-9 h-9 border-2 border-white ring-1 ring-slate-100">
                      <AvatarImage src={consult.studentPhoto} alt={consult.studentName} />
                      <AvatarFallback>{consult.studentName[0]}</AvatarFallback>
                    </Avatar>
                  </div>
                  <Badge className="bg-[#E8E6EB] text-[#024059] hover:bg-[#E8E6EB] rounded-md font-medium text-xs">
                    {consult.status}
                  </Badge>
                </div>

                {/* Separator */}
                <div className="border-t border-slate-100"></div>

                {/* Footer Info (mock stats) */}
                <div className="flex items-center justify-between text-slate-500 text-sm">
                  <div className="flex items-center gap-1.5">
                    <MessageSquareText className="w-4 h-4" /> 8
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="w-4 h-4" /> {consult.date}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}