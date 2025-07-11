import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { wsManager } from "@/lib/websocket";
import { 
  Play, 
  Pause, 
  RefreshCw, 
  Database, 
  Activity, 
  CheckCircle, 
  AlertCircle,
  Clock,
  BarChart3,
  Search,
  Brain,
  MapPin,
  FileText,
  Eye,
  Settings
} from "lucide-react";

interface PipelineStatus {
  id: number;
  status: 'idle' | 'running' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  totalJobs: number;
  processedJobs: number;
  newJobs: number;
  removedJobs: number;
  currentStep: string;
  errorMessage?: string;
}

interface ActivityLog {
  id: number;
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
  timestamp: string;
}

interface JobPosting {
  id: number;
  jobId: string;
  jobUrl: string;
  title: string;
  city?: string;
  state?: string;
  country?: string;
  zipcode?: string;
  latitude?: string;
  longitude?: string;
  description?: string;
  companyName?: string;
  createdAt: string;
}

interface SystemStatus {
  algoliaApi: boolean;
  azureOpenAI: boolean;
  googleGeocoding: boolean;
  azureSQL: boolean;
  connectionStatus: string;
}

interface PipelineProgress {
  type: 'status' | 'complete' | 'error';
  status?: string;
  step?: string;
  progress?: number;
  totalJobs?: number;
  processedJobs?: number;
  newJobs?: number;
  removedJobs?: number;
  message?: string;
}

export default function ControlCenter() {
  const { toast } = useToast();
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [batchSize, setBatchSize] = useState(50);
  const [activeTab, setActiveTab] = useState('control');
  const [processedJobs, setProcessedJobs] = useState<any[]>([]);
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);

  // Queries
  const { data: pipelineStatus, refetch: refetchStatus } = useQuery<PipelineStatus>({
    queryKey: ['/api/pipeline/status'],
    refetchInterval: 5000,
  });

  const { data: activityLogs } = useQuery<ActivityLog[]>({
    queryKey: ['/api/activity-logs'],
    refetchInterval: 10000,
  });

  const { data: systemStatus } = useQuery<SystemStatus>({
    queryKey: ['/api/system-status'],
    refetchInterval: 30000,
  });

  const { data: jobPostings, isLoading: jobPostingsLoading } = useQuery<JobPosting[]>({
    queryKey: ['/api/job-postings'],
    refetchInterval: 30000,
  });

  const { data: scheduleStatus } = useQuery<any>({
    queryKey: ['/api/schedule/status'],
    refetchInterval: 30000,
  });

  // Update local state when schedule status loads
  useEffect(() => {
    if (scheduleStatus) {
      setScheduleTime(scheduleStatus.time || '02:00');
      setScheduleEnabled(scheduleStatus.enabled || false);
    }
  }, [scheduleStatus]);

  // Mutations
  const startPipelineMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/pipeline/start', {
        method: 'POST',
        body: JSON.stringify({ batchSize }),
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Pipeline Started",
        description: `Processing ${batchSize} jobs from Algolia`,
      });
      setShowProgress(true);
      queryClient.invalidateQueries({ queryKey: ['/api/pipeline/status'] });
    },
    onError: (error: any) => {
      toast({
        title: "Pipeline Error",
        description: error.message || "Failed to start pipeline",
        variant: "destructive",
      });
    },
  });

  const clearLogsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/activity-logs', {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Logs Cleared",
        description: "Activity logs have been cleared",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/activity-logs'] });
    },
  });

  // WebSocket connection for real-time updates
  useEffect(() => {
    wsManager.connect();
    
    wsManager.onMessage((data: PipelineProgress) => {
      setPipelineProgress(data);
      
      if (data.type === 'complete') {
        setShowProgress(false);
        queryClient.invalidateQueries({ queryKey: ['/api/pipeline/status'] });
        queryClient.invalidateQueries({ queryKey: ['/api/activity-logs'] });
        
        // Fetch processed jobs data
        fetch('/api/pipeline/processed-jobs')
          .then(res => res.json())
          .then(jobs => setProcessedJobs(jobs))
          .catch(console.error);
      }
      
      if (data.type === 'error') {
        setShowProgress(false);
        toast({
          title: "Pipeline Error",
          description: data.message || "Pipeline execution failed",
          variant: "destructive",
        });
      }
    });

    return () => {
      wsManager.disconnect();
    };
  }, [toast]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getProgressPercentage = () => {
    if (pipelineProgress?.totalJobs && pipelineProgress?.processedJobs) {
      return Math.round((pipelineProgress.processedJobs / pipelineProgress.totalJobs) * 100);
    }
    if (pipelineStatus?.totalJobs && pipelineStatus?.processedJobs) {
      return Math.round((pipelineStatus.processedJobs / pipelineStatus.totalJobs) * 100);
    }
    return 0;
  };

  const getCurrentStep = () => {
    if (pipelineProgress?.step) {
      return pipelineProgress.step;
    }
    if (pipelineStatus?.currentStep) {
      return pipelineStatus.currentStep;
    }
    return 'Initializing...';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-azure-blue rounded-lg flex items-center justify-center">
                <Database className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-neutral-dark">Jobs Pipeline Control Center</h1>
                <p className="text-xs text-gray-500">Azure Function Apps | Data Pipeline Management</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-success-green rounded-full animate-pulse"></div>
                <span className="text-sm text-gray-600">
                  {systemStatus?.connectionStatus === 'connected' ? 'Connected to Azure' : 'Connecting...'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Custom Tab Navigation */}
        <div className="mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('control')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'control'
                    ? 'border-azure-blue text-azure-blue'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Pipeline Control
              </button>
              <button
                onClick={() => setActiveTab('data')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'data'
                    ? 'border-azure-blue text-azure-blue'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Processed Data ({processedJobs.length})
              </button>
              <button
                onClick={() => setActiveTab('jobs')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'jobs'
                    ? 'border-azure-blue text-azure-blue'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Job Postings ({jobPostings?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('schedule')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'schedule'
                    ? 'border-azure-blue text-azure-blue'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Schedule
              </button>
              <button
                onClick={() => setActiveTab('system')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'system'
                    ? 'border-azure-blue text-azure-blue'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                System Status
              </button>
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'control' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Pipeline Control Card */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-lg font-semibold text-neutral-dark">Data Pipeline Execution</h2>
                      <p className="text-sm text-gray-600">Fetch, process and sync job listings from Algolia to Azure SQL</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-3 h-3 bg-success-green rounded-full animate-pulse"></div>
                      <span className="text-sm text-gray-600">Ready</span>
                    </div>
                  </div>

                  {/* Batch Size Control */}
                  <div className="mb-6">
                    <Label htmlFor="batch-size" className="text-sm font-medium text-gray-700 mb-2 block">
                      Batch Size (jobs to process)
                    </Label>
                    <div className="flex items-center space-x-4">
                      <Input
                        id="batch-size"
                        type="number"
                        min="1"
                        max="1000"
                        value={batchSize}
                        onChange={(e) => setBatchSize(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                        className="w-32"
                      />
                      <div className="text-xs text-gray-500">
                        <span className="block">Recommended: 50-100 for testing</span>
                        <span className="block">Max: 1000 jobs per run</span>
                      </div>
                    </div>
                  </div>

                  {/* Control Buttons */}
                  <div className="flex space-x-4">
                    <Button
                      onClick={() => startPipelineMutation.mutate()}
                      disabled={pipelineStatus?.status === 'running' || startPipelineMutation.isPending}
                      className="bg-azure-blue hover:bg-azure-blue/90 text-white px-6"
                    >
                      {startPipelineMutation.isPending ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Start Pipeline
                        </>
                      )}
                    </Button>
                    
                    <Button
                      variant="outline"
                      onClick={() => refetchStatus()}
                      className="border-azure-blue text-azure-blue hover:bg-azure-blue/10"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh Status
                    </Button>
                  </div>

                  {/* Progress Section */}
                  {(showProgress || pipelineStatus?.status === 'running') && (
                    <div className="mt-6 p-4 bg-azure-blue/5 rounded-lg border border-azure-blue/20">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-azure-blue">Pipeline Progress</h3>
                        <Badge variant="outline" className="bg-azure-blue/10 text-azure-blue border-azure-blue/30">
                          {pipelineStatus?.status || 'running'}
                        </Badge>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-600">Current Step</span>
                            <span className="font-medium">{getCurrentStep()}</span>
                          </div>
                          <Progress value={getProgressPercentage()} className="h-2" />
                          <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>
                              {pipelineProgress?.processedJobs || pipelineStatus?.processedJobs || 0} / {pipelineProgress?.totalJobs || pipelineStatus?.totalJobs || 0} jobs
                            </span>
                            <span>{getProgressPercentage()}%</span>
                          </div>
                        </div>

                        {(pipelineProgress?.newJobs !== undefined || pipelineStatus?.newJobs !== undefined) && (
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">New Jobs:</span>
                              <span className="font-medium text-success-green">
                                +{pipelineProgress?.newJobs || pipelineStatus?.newJobs || 0}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Removed Jobs:</span>
                              <span className="font-medium text-error-red">
                                -{pipelineProgress?.removedJobs || pipelineStatus?.removedJobs || 0}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Last Execution Summary */}
                  {pipelineStatus && pipelineStatus.status !== 'running' && (
                    <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                      <h3 className="text-sm font-medium text-gray-700 mb-3">Last Execution Summary</h3>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Status:</span>
                          <Badge variant={pipelineStatus.status === 'completed' ? 'default' : 'destructive'}>
                            {pipelineStatus.status}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Duration:</span>
                          <span className="font-medium">
                            {pipelineStatus.endTime 
                              ? Math.round((new Date(pipelineStatus.endTime).getTime() - new Date(pipelineStatus.startTime).getTime()) / 1000) + 's'
                              : 'In progress'
                            }
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Jobs Processed:</span>
                          <span className="font-medium">{pipelineStatus.processedJobs}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Started:</span>
                          <span className="font-medium">{formatDate(pipelineStatus.startTime)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Activity Logs */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center space-x-2">
                      <Activity className="h-5 w-5 text-azure-blue" />
                      <span>Activity Logs</span>
                    </CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => clearLogsMutation.mutate()}
                      disabled={clearLogsMutation.isPending}
                      className="text-xs"
                    >
                      Clear
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64">
                    {activityLogs && activityLogs.length > 0 ? (
                      <div className="space-y-2">
                        {activityLogs.map((log) => (
                          <div key={log.id} className="text-xs p-2 rounded border-l-2" style={{
                            borderLeftColor: 
                              log.level === 'error' ? '#ef4444' :
                              log.level === 'warning' ? '#f59e0b' :
                              log.level === 'success' ? '#10b981' : '#6b7280'
                          }}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`font-medium ${
                                log.level === 'error' ? 'text-red-600' :
                                log.level === 'warning' ? 'text-yellow-600' :
                                log.level === 'success' ? 'text-green-600' : 'text-gray-600'
                              }`}>
                                {log.level.toUpperCase()}
                              </span>
                              <span className="text-gray-500">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-gray-700">{log.message}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <Clock className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-sm">No recent activity</p>
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* System Health */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <BarChart3 className="h-5 w-5 text-azure-blue" />
                    <span>System Health</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Algolia API Key</span>
                      <span className={systemStatus?.algoliaApi ? "text-success-green" : "text-error-red"}>
                        <CheckCircle className="w-4 h-4" />
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Azure OpenAI Key</span>
                      <span className={systemStatus?.azureOpenAI ? "text-success-green" : "text-error-red"}>
                        <CheckCircle className="w-4 h-4" />
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Google Geocoding Key</span>
                      <span className={systemStatus?.googleGeocoding ? "text-success-green" : "text-error-red"}>
                        <CheckCircle className="w-4 h-4" />
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">SQL Connection</span>
                      <span className="text-success-green">
                        <CheckCircle className="w-4 h-4" />
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4">
                  <Button 
                    variant="outline" 
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Advanced Settings
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <FileText className="h-5 w-5 text-azure-blue" />
                  <span>Processed Job Data</span>
                  <Badge variant="outline" className="ml-2">
                    {jobPostings?.length || 0} jobs
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {jobPostingsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-azure-blue" />
                    <span className="ml-2 text-gray-600">Loading processed jobs...</span>
                  </div>
                ) : !jobPostings || jobPostings.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Eye className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>No processed jobs available</p>
                    <p className="text-sm">Run the pipeline to see job data here</p>
                  </div>
                ) : (
                  <ScrollArea className="h-96">
                    <div className="space-y-4">
                      {jobPostings.slice(0, 20).map((job) => (
                        <div key={job.id} className="border rounded-lg p-4 bg-gray-50">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <h4 className="font-medium text-sm text-azure-blue mb-2">Original Data</h4>
                              <div className="text-xs space-y-1">
                                <p><strong>Title:</strong> {job.title}</p>
                                <p><strong>Job ID:</strong> {job.jobId}</p>
                                <p><strong>City:</strong> {job.city}</p>
                                <p><strong>Country:</strong> {job.country}</p>
                                <p><strong>Business Area:</strong> {job.description}</p>
                              </div>
                            </div>
                            <div>
                              <h4 className="font-medium text-sm text-success-green mb-2">AI Processed</h4>
                              <div className="text-xs space-y-1">
                                <p><strong>Parsed City:</strong> {job.city}</p>
                                <p><strong>Parsed State:</strong> {job.state}</p>
                                <p><strong>Parsed Country:</strong> {job.country}</p>
                              </div>
                            </div>
                            <div>
                              <h4 className="font-medium text-sm text-warning-orange mb-2">Geocoded</h4>
                              <div className="text-xs space-y-1">
                                <p><strong>Latitude:</strong> {job.latitude}</p>
                                <p><strong>Longitude:</strong> {job.longitude}</p>
                                <p><strong>Processed:</strong> {job.createdAt ? new Date(job.createdAt).toLocaleString() : 'Invalid Date'}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'schedule' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Schedule Configuration */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Clock className="h-5 w-5 text-azure-blue" />
                    <span>Automated Schedule</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="border rounded-lg p-4 bg-blue-50">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="font-medium text-neutral-dark">Daily Pipeline Execution</h3>
                          <p className="text-sm text-gray-600">Automatically fetch and process all Algolia job listings</p>
                        </div>
                        <Badge variant="outline" className="bg-success-green/10 text-success-green border-success-green/20">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Ready
                        </Badge>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <Label htmlFor="schedule-date" className="text-xs text-gray-600">Execution Date</Label>
                            <Input
                              id="schedule-date"
                              type="date"
                              value={scheduleDate}
                              onChange={(e) => setScheduleDate(e.target.value)}
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label htmlFor="schedule-time" className="text-xs text-gray-600">Execution Time (Eastern)</Label>
                            <Input
                              id="schedule-time"
                              type="time"
                              value={scheduleTime}
                              onChange={(e) => setScheduleTime(e.target.value)}
                              className="mt-1"
                            />
                          </div>
                          <div className="flex items-end">
                            <div className="text-sm">
                              <div className="text-gray-600">Status:</div>
                              <div className="font-medium text-success-green">
                                {scheduleEnabled ? 'Active' : 'Ready'}
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Next Run:</span>
                          <span className="font-medium">
                            {(() => {
                              const [hours, minutes] = scheduleTime.split(':').map(Number);
                              const nextRun = new Date(scheduleDate);
                              nextRun.setHours(hours, minutes, 0, 0);
                              
                              // If the selected date/time is in the past, show it in red
                              const isPast = nextRun <= new Date();
                              return (
                                <span className={isPast ? 'text-red-500' : ''}>
                                  {nextRun.toLocaleString('en-US', {
                                    weekday: 'short',
                                    month: 'short', 
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                    timeZoneName: 'short'
                                  })}
                                  {isPast && ' (Past)'}
                                </span>
                              );
                            })()}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Batch Size:</span>
                          <span className="font-medium">1000 jobs per batch</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Button 
                        className="w-full bg-azure-blue hover:bg-azure-blue/90 text-white"
                        onClick={async () => {
                          try {
                            const [hours, minutes] = scheduleTime.split(':').map(Number);
                            const selectedDateTime = new Date(scheduleDate);
                            selectedDateTime.setHours(hours, minutes, 0, 0);
                            
                            // Determine if this is a one-time or recurring schedule
                            const isOneTime = selectedDateTime.toDateString() !== new Date().toDateString();
                            
                            const response = await fetch('/api/schedule/activate', {
                              method: 'POST',
                              body: JSON.stringify({ 
                                enabled: true, 
                                time: scheduleTime, 
                                date: scheduleDate,
                                timezone: "America/New_York",
                                oneTime: isOneTime
                              }),
                              headers: { 'Content-Type': 'application/json' }
                            });
                            
                            if (!response.ok) throw new Error('Failed to activate schedule');
                            
                            setScheduleEnabled(true);
                            
                            // Refresh schedule status
                            queryClient.invalidateQueries({ queryKey: ['/api/schedule/status'] });
                            
                            toast({
                              title: "Schedule Activated",
                              description: isOneTime 
                                ? `One-time pipeline execution scheduled for ${selectedDateTime.toLocaleString()} with 1000 job batches.`
                                : `Daily pipeline execution scheduled for ${scheduleTime} Eastern time with 1000 job batches.`,
                            });
                          } catch (error) {
                            toast({
                              title: "Error",
                              description: "Failed to activate schedule. Please try again.",
                              variant: "destructive"
                            });
                          }
                        }}
                      >
                        <Play className="w-4 h-4 mr-2" />
                        {(() => {
                          const [hours, minutes] = scheduleTime.split(':').map(Number);
                          const selectedDateTime = new Date(scheduleDate);
                          selectedDateTime.setHours(hours, minutes, 0, 0);
                          const isOneTime = selectedDateTime.toDateString() !== new Date().toDateString();
                          
                          if (scheduleEnabled) {
                            return 'Update Schedule';
                          } else if (isOneTime) {
                            return 'Schedule One-Time Run';
                          } else {
                            return 'Activate Daily Schedule';
                          }
                        })()}
                      </Button>
                      
                      <Button 
                        variant="outline" 
                        className="w-full"
                        onClick={async () => {
                          try {
                            const response = await fetch('/api/schedule/test', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' }
                            });
                            
                            if (!response.ok) throw new Error('Failed to start test execution');
                            
                            toast({
                              title: "Test Run Started",
                              description: "Running pipeline with 1000 job batches to verify schedule configuration.",
                            });
                            setActiveTab('control');
                          } catch (error) {
                            toast({
                              title: "Error",
                              description: "Failed to start test execution. Please try again.",
                              variant: "destructive"
                            });
                          }
                        }}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Test Schedule (Run Now)
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Schedule History */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Activity className="h-5 w-5 text-azure-blue" />
                    <span>Schedule History</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Manual Execution</span>
                        <Badge variant="outline" className="bg-success-green/10 text-success-green border-success-green/20">
                          Completed
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-600 space-y-1">
                        <div>Started: {pipelineStatus?.startTime ? new Date(pipelineStatus.startTime).toLocaleString() : 'Never'}</div>
                        <div>Duration: {pipelineStatus?.endTime && pipelineStatus?.startTime ? 
                          Math.round((new Date(pipelineStatus.endTime).getTime() - new Date(pipelineStatus.startTime).getTime()) / 1000) + 's' : 
                          'N/A'}
                        </div>
                        <div>Jobs Processed: {pipelineStatus?.totalJobs || 0}</div>
                      </div>
                    </div>
                    
                    <div className="text-center py-4 text-gray-500">
                      <Clock className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm">No scheduled executions yet</p>
                      <p className="text-xs mt-1">Activate the daily schedule to see automated runs here</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Schedule Configuration Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Settings className="h-5 w-5 text-azure-blue" />
                  <span>Schedule Configuration</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <h4 className="font-medium text-sm text-azure-blue mb-3">Execution Details</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Frequency:</span>
                        <span>Daily</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Time:</span>
                        <span>{scheduleTime} UTC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Batch Size:</span>
                        <span>1000 jobs</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Timezone:</span>
                        <span>UTC</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Timeout:</span>
                        <span>30 minutes</span>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-sm text-success-green mb-3">Data Processing</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Source:</span>
                        <span>Algolia API</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">AI Processing:</span>
                        <span>Azure OpenAI</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Geocoding:</span>
                        <span>Azure SQL Zipcode Table</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Storage:</span>
                        <span>Azure SQL</span>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-sm text-warning-orange mb-3">Notifications</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Success:</span>
                        <span>Dashboard Log</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Failure:</span>
                        <span>Error Log</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Email:</span>
                        <span>Disabled</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Retry Policy:</span>
                        <span>3 attempts</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <BarChart3 className="h-5 w-5 text-azure-blue" />
                    <span>System Status</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Search className="h-5 w-5 text-azure-blue" />
                          <div>
                            <h3 className="font-medium text-neutral-dark">Algolia API</h3>
                            <p className="text-xs text-gray-500">Job listings source</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-success-green/10 text-success-green border-success-green/20">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Online
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Brain className="h-5 w-5 text-azure-blue" />
                          <div>
                            <h3 className="font-medium text-neutral-dark">Azure OpenAI</h3>
                            <p className="text-xs text-gray-500">GPT-4o-mini</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={
                          systemStatus?.azureOpenAI 
                            ? "bg-success-green/10 text-success-green border-success-green/20"
                            : "bg-error-red/10 text-error-red border-error-red/20"
                        }>
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {systemStatus?.azureOpenAI ? 'Online' : 'Offline'}
                        </Badge>
                      </div>
                    </div>

                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <MapPin className="h-5 w-5 text-azure-blue" />
                          <div>
                            <h3 className="font-medium text-neutral-dark">Google Geocoding</h3>
                            <p className="text-xs text-gray-500">Location coordinates</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={
                          systemStatus?.googleGeocoding 
                            ? "bg-success-green/10 text-success-green border-success-green/20"
                            : "bg-error-red/10 text-error-red border-error-red/20"
                        }>
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {systemStatus?.googleGeocoding ? 'Online' : 'Offline'}
                        </Badge>
                      </div>
                    </div>

                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Database className="h-5 w-5 text-azure-blue" />
                          <div>
                            <h3 className="font-medium text-neutral-dark">Azure SQL Database</h3>
                            <p className="text-xs text-gray-500">Data storage</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-success-green/10 text-success-green border-success-green/20">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Connected
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Pipeline Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 border rounded-lg">
                      <span className="text-gray-600">Last Execution</span>
                      <span className="font-medium">
                        {pipelineStatus?.startTime 
                          ? formatDate(pipelineStatus.startTime) 
                          : 'Never'
                        }
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 border rounded-lg">
                      <span className="text-gray-600">Total Jobs Processed</span>
                      <span className="font-medium">{pipelineStatus?.totalJobs || 0}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 border rounded-lg">
                      <span className="text-gray-600">New Jobs Added</span>
                      <span className="font-medium text-success-green">{pipelineStatus?.newJobs || 0}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 border rounded-lg">
                      <span className="text-gray-600">Jobs Removed</span>
                      <span className="font-medium text-error-red">{pipelineStatus?.removedJobs || 0}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 border rounded-lg">
                      <span className="text-gray-600">Current Status</span>
                      <span className="font-medium">{pipelineStatus?.status || 'Idle'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Job Postings Tab */}
        {activeTab === 'jobs' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <FileText className="h-5 w-5" />
                  <span>Job Postings Database</span>
                  <Badge variant="outline" className="ml-2">
                    {jobPostings?.length || 0} records
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {jobPostingsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin text-azure-blue" />
                    <span className="ml-2 text-gray-600">Loading job postings...</span>
                  </div>
                ) : jobPostings && jobPostings.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">{jobPostings.length}</div>
                        <div className="text-sm text-gray-600">Total Job Postings</div>
                      </div>
                      <div className="bg-green-50 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">
                          {jobPostings.filter(job => job.zipcode && job.zipcode !== 'none').length}
                        </div>
                        <div className="text-sm text-gray-600">With Zipcode Data</div>
                      </div>
                      <div className="bg-purple-50 p-4 rounded-lg">
                        <div className="text-2xl font-bold text-purple-600">
                          {new Set(jobPostings.map(job => job.companyName).filter(Boolean)).size}
                        </div>
                        <div className="text-sm text-gray-600">Unique Companies</div>
                      </div>
                    </div>
                    
                    <ScrollArea className="h-96 border rounded-lg">
                      <div className="p-4 space-y-3">
                        {jobPostings.map((job) => (
                          <div key={job.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1">
                                <h3 className="font-semibold text-gray-900 mb-1">{job.title}</h3>
                                <div className="flex items-center space-x-4 text-sm text-gray-600">
                                  {job.companyName && (
                                    <span className="font-medium">{job.companyName}</span>
                                  )}
                                  {job.city && job.state && (
                                    <div className="flex items-center space-x-1">
                                      <MapPin className="h-3 w-3" />
                                      <span>{job.city}, {job.state}</span>
                                      {job.zipcode && job.zipcode !== 'none' && (
                                        <Badge variant="secondary" className="text-xs">
                                          {job.zipcode}
                                        </Badge>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                {job.latitude && job.longitude && (
                                  <Badge variant="outline" className="text-xs">
                                    <MapPin className="h-2 w-2 mr-1" />
                                    Geocoded
                                  </Badge>
                                )}
                              </div>
                            </div>
                            
                            {job.description && (
                              <div className="text-sm text-gray-600 mt-2 line-clamp-2">
                                {job.description.length > 150 
                                  ? `${job.description.substring(0, 150)}...` 
                                  : job.description
                                }
                              </div>
                            )}
                            
                            <div className="flex justify-between items-center mt-3">
                              <div className="flex items-center space-x-2">
                                <Badge variant="outline" className="text-xs">
                                  ID: {job.jobId}
                                </Badge>
                                {job.latitude && job.longitude && (
                                  <span className="text-xs text-gray-500">
                                    📍 {parseFloat(job.latitude).toFixed(4)}, {parseFloat(job.longitude).toFixed(4)}
                                  </span>
                                )}
                                {job.jobUrl && (
                                  <span className="text-xs text-blue-600 truncate max-w-xs">
                                    🔗 {job.jobUrl.replace('https://', '').substring(0, 40)}...
                                  </span>
                                )}
                              </div>
                              {job.jobUrl && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open(job.jobUrl, '_blank')}
                                  className="text-xs"
                                >
                                  <Eye className="h-3 w-3 mr-1" />
                                  View Job
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No job postings found in the database</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Run the pipeline to fetch and process job data from Algolia
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}