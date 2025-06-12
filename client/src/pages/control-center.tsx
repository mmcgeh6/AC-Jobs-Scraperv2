import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Database, 
  Search, 
  Brain, 
  MapPin, 
  CheckCircle, 
  Loader2, 
  Clock, 
  Settings,
  Trash2,
  Circle,
  Eye,
  FileText,
  BarChart3
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

  // Queries
  const { data: pipelineStatus, refetch: refetchStatus } = useQuery<PipelineStatus>({
    queryKey: ['/api/pipeline/status'],
    refetchInterval: 5000,
  });

  const { data: activityLogs = [] } = useQuery<ActivityLog[]>({
    queryKey: ['/api/activity-logs'],
    refetchInterval: 10000,
  });

  const { data: systemStatus } = useQuery<SystemStatus>({
    queryKey: ['/api/system-status'],
    refetchInterval: 30000,
  });

  const { data: processedJobs = [] } = useQuery<any[]>({
    queryKey: ['/api/processed-jobs'],
    refetchInterval: 5000,
  });

  // Mutations
  const startPipelineMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/pipeline/start', { batchSize }),
    onSuccess: () => {
      toast({
        title: "Pipeline Started",
        description: `Processing ${batchSize} jobs from Algolia.`,
      });
      setShowProgress(true);
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['/api/processed-jobs'] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Start Pipeline",
        description: error.message || "An error occurred while starting the pipeline.",
        variant: "destructive",
      });
    },
  });

  const clearLogsMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/activity-logs'),
    onSuccess: () => {
      toast({
        title: "Logs Cleared",
        description: "Activity logs have been cleared successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/activity-logs'] });
    },
  });

  // WebSocket setup
  useEffect(() => {
    wsManager.connect();
    
    wsManager.onMessage((data: PipelineProgress) => {
      setPipelineProgress(data);
      
      if (data.type === 'complete') {
        setShowProgress(false);
        toast({
          title: "Pipeline Completed",
          description: `Successfully processed jobs. New: ${data.newJobs}, Removed: ${data.removedJobs}`,
        });
        refetchStatus();
        queryClient.invalidateQueries({ queryKey: ['/api/activity-logs'] });
      } else if (data.type === 'error') {
        setShowProgress(false);
        toast({
          title: "Pipeline Failed",
          description: data.message || "An error occurred during pipeline execution.",
          variant: "destructive",
        });
        refetchStatus();
      }
    });

    return () => {
      wsManager.disconnect();
    };
  }, [toast, refetchStatus]);

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return `Today, ${formatTime(dateString)}`;
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    
    if (isYesterday) {
      return `Yesterday at ${formatTime(dateString)}`;
    }
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getStatusBadge = () => {
    if (showProgress || pipelineProgress?.type === 'status') {
      return (
        <Badge variant="outline" className="bg-azure-blue/10 text-azure-blue border-azure-blue/20">
          <Circle className="w-2 h-2 mr-2 fill-current" />
          Running
        </Badge>
      );
    }

    if (pipelineStatus?.status === 'completed') {
      return (
        <Badge variant="outline" className="bg-success-green/10 text-success-green border-success-green/20">
          <CheckCircle className="w-2 h-2 mr-2" />
          Completed
        </Badge>
      );
    }

    if (pipelineStatus?.status === 'failed') {
      return (
        <Badge variant="outline" className="bg-error-red/10 text-error-red border-error-red/20">
          <Circle className="w-2 h-2 mr-2 fill-current" />
          Failed
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-200">
        <Circle className="w-2 h-2 mr-2 fill-current" />
        Idle
      </Badge>
    );
  };

  const getCurrentProgress = () => {
    if (pipelineProgress?.progress !== undefined) {
      return pipelineProgress.progress;
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
                    <h2 className="text-xl font-semibold text-neutral-dark">Pipeline Control</h2>
                    <p className="text-sm text-gray-500 mt-1">Manually trigger the data pipeline process</p>
                  </div>
                  {getStatusBadge()}
                </div>

                {/* Batch Size Control */}
                <div className="border rounded-lg p-4 mb-4 bg-gray-50">
                  <Label htmlFor="batchSize" className="text-sm font-medium text-neutral-dark">
                    Batch Size (Number of jobs to process)
                  </Label>
                  <div className="flex items-center space-x-4 mt-2">
                    <Input
                      id="batchSize"
                      type="number"
                      value={batchSize}
                      onChange={(e) => setBatchSize(Number(e.target.value))}
                      min={1}
                      max={1000}
                      className="w-32"
                    />
                    <span className="text-sm text-gray-500">
                      Recommended: 50-100 for testing, up to 1000 for production
                    </span>
                  </div>
                </div>

                {/* Manual Trigger Section */}
                <div className="border rounded-lg p-4 mb-6 bg-gradient-to-r from-azure-blue/5 to-azure-dark/5">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium text-neutral-dark mb-2">Manual Pipeline Execution</h3>
                      <p className="text-sm text-gray-600 mb-4">Process {batchSize} jobs: Algolia → AI Processing → Geocoding → SQL Database</p>
                      
                      {/* Pipeline Steps Preview */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
                        <div className="flex items-center space-x-2 text-xs">
                          <div className="w-6 h-6 bg-azure-blue/10 rounded-full flex items-center justify-center">
                            <Search className="h-3 w-3 text-azure-blue" />
                          </div>
                          <span className="text-gray-600">Fetch Jobs</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <div className="w-6 h-6 bg-azure-blue/10 rounded-full flex items-center justify-center">
                            <Brain className="h-3 w-3 text-azure-blue" />
                          </div>
                          <span className="text-gray-600">AI Processing</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <div className="w-6 h-6 bg-azure-blue/10 rounded-full flex items-center justify-center">
                            <MapPin className="h-3 w-3 text-azure-blue" />
                          </div>
                          <span className="text-gray-600">Geocoding</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <div className="w-6 h-6 bg-azure-blue/10 rounded-full flex items-center justify-center">
                            <Database className="h-3 w-3 text-azure-blue" />
                          </div>
                          <span className="text-gray-600">SQL Sync</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Action Button */}
                  <Button 
                    onClick={() => startPipelineMutation.mutate()}
                    disabled={startPipelineMutation.isPending || showProgress}
                    className="w-full sm:w-auto bg-azure-blue hover:bg-azure-dark text-white"
                  >
                    {startPipelineMutation.isPending || showProgress ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Pipeline
                      </>
                    )}
                  </Button>
                </div>

                {/* Progress Section */}
                {(showProgress || pipelineProgress?.type === 'status') && (
                  <div className="border rounded-lg p-4 bg-blue-50">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-neutral-dark">Pipeline Progress</h3>
                      <span className="text-sm text-azure-blue font-medium">{getCurrentStep()}</span>
                    </div>
                    
                    {/* Progress Bar */}
                    <Progress value={getCurrentProgress()} className="mb-4" />

                    {/* Step Details */}
                    <div className="space-y-2 text-sm">
                      {pipelineProgress?.totalJobs && (
                        <>
                          <div className="flex items-center space-x-2">
                            <CheckCircle className="h-4 w-4 text-success-green" />
                            <span className="text-gray-600">Fetched {pipelineProgress.totalJobs} job listings from Algolia</span>
                          </div>
                          
                          {pipelineProgress.processedJobs !== undefined && (
                            <div className="flex items-center space-x-2">
                              <Loader2 className="h-4 w-4 text-azure-blue animate-spin" />
                              <span className="text-gray-600">Processing locations with AI ({pipelineProgress.processedJobs}/{pipelineProgress.totalJobs})</span>
                            </div>
                          )}
                          
                          <div className="flex items-center space-x-2 text-gray-400">
                            <Clock className="h-4 w-4" />
                            <span>Pending: Geocoding coordinates</span>
                          </div>
                          <div className="flex items-center space-x-2 text-gray-400">
                            <Clock className="h-4 w-4" />
                            <span>Pending: Database synchronization</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* System Status Card */}
            <Card>
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold text-neutral-dark mb-4">System Status</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        Online
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Last Execution Summary */}
            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-neutral-dark mb-4">Last Execution</h2>
                
                {pipelineStatus ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Status</span>
                      <Badge variant="outline" className={
                        pipelineStatus.status === 'completed' 
                          ? "bg-success-green/10 text-success-green border-success-green/20"
                          : pipelineStatus.status === 'failed'
                          ? "bg-error-red/10 text-error-red border-error-red/20"
                          : "bg-azure-blue/10 text-azure-blue border-azure-blue/20"
                      }>
                        <CheckCircle className="w-3 h-3 mr-1" />
                        {pipelineStatus.status === 'completed' ? 'Success' : 
                         pipelineStatus.status === 'failed' ? 'Failed' : 'Running'}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Started</span>
                      <span className="text-sm text-neutral-dark">{formatDate(pipelineStatus.startTime)}</span>
                    </div>
                    {pipelineStatus.endTime && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Duration</span>
                        <span className="text-sm text-neutral-dark">
                          {Math.round((new Date(pipelineStatus.endTime).getTime() - new Date(pipelineStatus.startTime).getTime()) / 1000)}s
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Jobs Processed</span>
                      <span className="text-sm text-neutral-dark">{pipelineStatus.totalJobs}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">New Jobs Added</span>
                      <span className="text-sm text-success-green font-medium">+{pipelineStatus.newJobs}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Old Jobs Removed</span>
                      <span className="text-sm text-error-red">-{pipelineStatus.removedJobs}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No executions found</p>
                )}
              </CardContent>
            </Card>

            {/* Activity Log */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-neutral-dark">Activity Log</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => clearLogsMutation.mutate()}
                    disabled={clearLogsMutation.isPending}
                    className="text-azure-blue hover:text-azure-dark"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                </div>
                
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {activityLogs.length > 0 ? (
                    activityLogs.map((log) => (
                      <div key={log.id} className="flex items-start space-x-3 pb-3 border-b border-gray-100 last:border-b-0">
                        <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                          log.level === 'success' ? 'bg-success-green' :
                          log.level === 'error' ? 'bg-error-red' :
                          log.level === 'warning' ? 'bg-warning-orange' :
                          'bg-azure-blue'
                        }`}></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-neutral-dark">{log.message}</p>
                          <p className="text-xs text-gray-500 mt-1">{formatDate(log.timestamp)}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No activity logs found</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Configuration */}
            <Card>
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold text-neutral-dark mb-4">Configuration</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Daily Schedule</label>
                    <div className="flex items-center space-x-2">
                      <input 
                        type="time" 
                        defaultValue="13:00" 
                        className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-azure-blue focus:border-azure-blue" 
                      />
                      <span className="text-sm text-gray-500">EST (UTC-5)</span>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Environment Status</label>
                    <div className="space-y-2 text-sm">
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
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Advanced Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
              </div>
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
                    {processedJobs.length} jobs
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {processedJobs.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Eye className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>No processed jobs available</p>
                    <p className="text-sm">Run the pipeline to see job data here</p>
                  </div>
                ) : (
                  <ScrollArea className="h-96">
                    <div className="space-y-4">
                      {processedJobs.map((job, index) => (
                        <div key={index} className="border rounded-lg p-4 bg-gray-50">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <h4 className="font-medium text-sm text-azure-blue mb-2">Original Data</h4>
                              <div className="text-xs space-y-1">
                                <p><strong>Title:</strong> {job.originalData?.title}</p>
                                <p><strong>Job ID:</strong> {job.originalData?.jobID}</p>
                                <p><strong>City:</strong> {job.originalData?.city}</p>
                                <p><strong>Country:</strong> {job.originalData?.country}</p>
                                <p><strong>Business Area:</strong> {job.originalData?.businessArea}</p>
                              </div>
                            </div>
                            <div>
                              <h4 className="font-medium text-sm text-success-green mb-2">AI Processed</h4>
                              <div className="text-xs space-y-1">
                                <p><strong>Parsed City:</strong> {job.aiProcessed?.city}</p>
                                <p><strong>Parsed State:</strong> {job.aiProcessed?.state}</p>
                                <p><strong>Parsed Country:</strong> {job.aiProcessed?.country}</p>
                              </div>
                            </div>
                            <div>
                              <h4 className="font-medium text-sm text-warning-orange mb-2">Geocoded</h4>
                              <div className="text-xs space-y-1">
                                <p><strong>Latitude:</strong> {job.coordinates?.latitude}</p>
                                <p><strong>Longitude:</strong> {job.coordinates?.longitude}</p>
                                <p><strong>Processed:</strong> {new Date(job.timestamp).toLocaleTimeString()}</p>
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
      </main>
    </div>
  );
}
