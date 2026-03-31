import { useState, useEffect, useRef, ReactNode, MouseEvent } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useSpring } from 'motion/react';
import { 
  Rocket, 
  Target, 
  TrendingUp, 
  TrendingDown,
  ChevronRight, 
  Coins, 
  Users, 
  Zap,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Send,
  Video,
  BookOpen,
  Globe,
  Building2,
  Play,
  Square,
  RefreshCw,
  LogOut,
  User as UserIcon,
  LayoutDashboard,
  History
} from 'lucide-react';
import { generateStages, evaluatePitch, evaluateVideoPitch, evaluateMockPitch, evaluatePptPitch } from './services/ai';
import { GameState, Stage } from './types';
import { auth, signInWithGoogle, logout, saveUserProgress, saveStageHistory, saveFinalProposal, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

const INITIAL_METRICS = {
  trust: 0,
  impact: 0
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'home' | 'map' | 'stage' | 'result' | 'dashboard'>('home');
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);
  const [simulationResult, setSimulationResult] = useState<string | null>(null);
  const [pitchText, setPitchText] = useState('');
  const [mockPitchFeedback, setMockPitchFeedback] = useState<{ score: number; feedback: string; questions: string[]; isBad?: boolean } | null>(null);
  const [videoFeedback, setVideoFeedback] = useState<{ score: number; feedback: string; questions: string[]; isBad?: boolean } | null>(null);
  const [pptFeedback, setPptFeedback] = useState<{ score: number; feedback: string; questions: string[]; isBad?: boolean } | null>(null);
  const [pitchError, setPitchError] = useState<string | null>(null);
  const [proposalStatus, setProposalStatus] = useState<{ status: string; review: string } | null>(null);
  const initialLoadRef = useRef(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load Progress from Firestore
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.gameState) {
          const loadedState = {
            ...data.gameState,
            performanceHistory: data.gameState.performanceHistory || []
          };
          setGameState(loadedState);
          // If game state exists, move to map if at home and first load
          if (view === 'home' && !initialLoadRef.current) {
            setView('map');
            initialLoadRef.current = true;
          }
        }
      }
    });

    const proposalRef = doc(db, 'proposals', user.uid);
    const unsubscribeProposal = onSnapshot(proposalRef, (docSnap) => {
      if (docSnap.exists()) {
        setProposalStatus(docSnap.data() as any);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeProposal();
    };
  }, [user, view]);

  const handleStart = async (idea: string, budget: string) => {
    if (!user) {
      alert("Please sign in to start your journey!");
      return;
    }
    setLoading(true);
    try {
      const stages = await generateStages(idea, budget);
      const numericBudget = parseInt(budget.replace(/[^0-9]/g, '')) || 100000;
      const newGameState: GameState = {
        idea,
        audience: "Investors & Stakeholders",
        budget: numericBudget,
        ...INITIAL_METRICS,
        currentStage: 1,
        stages,
        isGameOver: false,
        stageStatus: 'overview',
        performanceHistory: []
      };
      setGameState(newGameState);
      await saveUserProgress(user.uid, '1', { gameState: newGameState });
      setView('map');
    } catch (error) {
      console.error("Failed to start journey:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleChoice = async (impact: { budget: number; trust: number; impact: number }, feedback: string) => {
    if (!gameState || !user) return;
    
    const updatedState = {
      ...gameState,
      budget: Math.max(0, gameState.budget + impact.budget),
      trust: Math.min(100, Math.max(0, gameState.trust + impact.trust)),
      impact: Math.max(0, gameState.impact + impact.impact),
      performanceHistory: [...gameState.performanceHistory, (impact.budget > 0 ? 30 : 10) + (impact.trust > 0 ? 40 : 10) + (impact.impact > 0 ? 30 : 10)]
    };
    
    setGameState(updatedState);
    setSimulationResult(feedback);
    await saveUserProgress(user.uid, String(gameState.currentStage), { gameState: updatedState });
  };

  const handleMockPitchSubmit = async (text: string) => {
    if (!gameState || !selectedStage || !user) return;
    setLoading(true);
    try {
      const feedback = await evaluateMockPitch(gameState.idea, selectedStage.name, text);
      setMockPitchFeedback(feedback);
      
      // Dynamic impact based on score
      // Score > 70: Significant increase
      // Score 40-70: Minor increase
      // Score < 40: Decrease
      let budgetChange = 0;
      if (feedback.score > 70) budgetChange = feedback.score * 5000;
      else if (feedback.score >= 40) budgetChange = feedback.score * 1000;
      else budgetChange = -(40 - feedback.score) * 2000;

      const impact = {
        budget: budgetChange,
        trust: Math.floor(feedback.score / 2) - 10, // -10 to +40
        impact: Math.floor(feedback.score / 10)
      };
      
      const updatedState = {
        ...gameState,
        budget: Math.max(0, gameState.budget + impact.budget),
        trust: Math.min(100, Math.max(0, gameState.trust + impact.trust)),
        impact: Math.max(0, gameState.impact + impact.impact),
        performanceHistory: [...gameState.performanceHistory, feedback.score]
      };
      
      setGameState(updatedState);
      await saveUserProgress(user.uid, String(gameState.currentStage), { gameState: updatedState });
      await saveStageHistory(user.uid, selectedStage.name, feedback.score, feedback.feedback);
    } catch (error) {
      console.error("Mock pitch evaluation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleVideoPitchSubmit = async (videoBase64: string, mimeType: string) => {
    if (!gameState || !selectedStage || !user) return;
    setLoading(true);
    setPitchError(null);
    try {
      const feedback = await evaluateVideoPitch(gameState.idea, selectedStage.name, videoBase64, mimeType);
      setVideoFeedback(feedback);
      
      // Dynamic impact based on score
      let budgetChange = 0;
      if (feedback.score > 70) budgetChange = feedback.score * 8000;
      else if (feedback.score >= 40) budgetChange = feedback.score * 2000;
      else budgetChange = -(40 - feedback.score) * 3000;

      const impact = {
        budget: budgetChange,
        trust: Math.floor(feedback.score / 1.5) - 15, // -15 to +51
        impact: Math.floor(feedback.score / 8)
      };
      
      const updatedState = {
        ...gameState,
        budget: Math.max(0, gameState.budget + impact.budget),
        trust: Math.min(100, Math.max(0, gameState.trust + impact.trust)),
        impact: Math.max(0, gameState.impact + impact.impact),
        stageStatus: 'feedback',
        performanceHistory: [...gameState.performanceHistory, feedback.score]
      };
      
      setGameState(updatedState);
      await saveUserProgress(user.uid, String(gameState.currentStage), { gameState: updatedState });
      await saveStageHistory(user.uid, selectedStage.name, feedback.score, feedback.feedback);
    } catch (error) {
      console.error("Video pitch evaluation failed:", error);
      setPitchError("Video pitch evaluation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePptPitchSubmit = async (text: string) => {
    if (!gameState || !selectedStage || !user) return;
    setLoading(true);
    try {
      const feedback = await evaluatePptPitch(gameState.idea, selectedStage.name, text);
      setPptFeedback(feedback);
      
      // Dynamic impact based on score
      let budgetChange = 0;
      if (feedback.score > 70) budgetChange = feedback.score * 10000;
      else if (feedback.score >= 40) budgetChange = feedback.score * 3000;
      else budgetChange = -(40 - feedback.score) * 4000;

      const impact = {
        budget: budgetChange,
        trust: Math.floor(feedback.score / 1.2) - 20, // -20 to +63
        impact: Math.floor(feedback.score / 5)
      };
      
      const updatedState = {
        ...gameState,
        budget: Math.max(0, gameState.budget + impact.budget),
        trust: Math.min(100, Math.max(0, gameState.trust + impact.trust)),
        impact: Math.max(0, gameState.impact + impact.impact),
        stageStatus: 'feedback',
        performanceHistory: [...gameState.performanceHistory, feedback.score]
      };
      
      setGameState(updatedState);
      await saveUserProgress(user.uid, String(gameState.currentStage), { gameState: updatedState });
      await saveStageHistory(user.uid, selectedStage.name, feedback.score, feedback.feedback);
    } catch (error) {
      console.error("PPT pitch evaluation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSimulation = async () => {
    if (!gameState || !selectedStage || !user) return;
    
    const cost = selectedStage.simulationCost || 0;
    if (gameState.budget < cost) {
      alert(`Insufficient budget! You need $${cost.toLocaleString()} to attempt this stage, but you only have $${gameState.budget.toLocaleString()}.`);
      return;
    }

    const updatedState = { 
      ...gameState, 
      budget: gameState.budget - cost,
      stageStatus: 'simulation' as const 
    };
    setGameState(updatedState);
    await saveUserProgress(user.uid, String(gameState.currentStage), { gameState: updatedState });
  };

  const handleRetryStage = async (type: 'video' | 'mock' | 'ppt') => {
    if (!gameState || !selectedStage || !user) return;
    
    const cost = selectedStage.simulationCost || 0;
    if (gameState.budget < cost) {
      alert(`Insufficient budget to retry! You need $${cost.toLocaleString()} to retry, but you only have $${gameState.budget.toLocaleString()}.`);
      return;
    }

    const updatedState = {
      ...gameState,
      budget: gameState.budget - cost,
      stageStatus: 'simulation' as const
    };

    if (type === 'video') {
      setVideoFeedback(null);
      setPitchError(null);
    } else if (type === 'mock') {
      setMockPitchFeedback(null);
    } else if (type === 'ppt') {
      setPptFeedback(null);
    }

    setGameState(updatedState);
    await saveUserProgress(user.uid, String(gameState.currentStage), { gameState: updatedState });
  };

  const nextStage = async () => {
    if (!gameState || !user) return;
    const isLastStage = gameState.currentStage === gameState.stages.length;
    
    if (isLastStage && gameState.stageStatus === 'feedback') {
      const updatedState = { ...gameState, stageStatus: 'simulation' as const };
      setGameState(updatedState);
      await saveUserProgress(user.uid, String(gameState.currentStage), { gameState: updatedState });
      setView('stage');
    } else {
      const updatedState = { 
        ...gameState, 
        currentStage: gameState.currentStage + 1,
        stageStatus: 'overview' as const
      };
      setGameState(updatedState);
      setSimulationResult(null);
      setMockPitchFeedback(null);
      setVideoFeedback(null);
      setPptFeedback(null);
      setPitchText('');
      await saveUserProgress(user.uid, String(updatedState.currentStage), { gameState: updatedState });
      setView('map');
    }
  };

  const handlePitchSubmit = async () => {
    if (!gameState || !user) return;
    setLoading(true);
    try {
      const feedback = await evaluatePitch(gameState.idea, pitchText);
      const isAccepted = feedback.score >= 70;
      const status = isAccepted ? 'accepted' : 'rejected';
      
      setGameState(prev => prev ? { ...prev, pitchFeedback: feedback, isGameOver: true } : null);
      await saveFinalProposal(user.uid, status as any, feedback.feedback);
      setView('result');
    } catch (error) {
      console.error("Pitch evaluation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <div className="w-12 h-12 border-4 border-black/10 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginView onLogin={signInWithGoogle} loading={loading} />;
  }

  return (
    <div className="min-h-screen bg-white text-foreground selection:bg-foreground selection:text-white font-sans">
      {/* Navigation Bar */}
      {view !== 'dashboard' && (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md h-20 border-b border-black/5">
          <div className="max-w-7xl mx-auto flex justify-between items-center px-8 h-full">
            <div className="flex items-center gap-12">
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setView('home')}
                className="text-3xl tracking-tight font-serif text-foreground cursor-pointer"
              >
                StartupSim<span className="text-xs align-top ml-0.5">®</span>
              </motion.div>
              
              <div className="hidden md:flex items-center gap-8 text-sm">
                {['Home', 'Simulation', 'Dashboard'].map((item, i) => (
                  <motion.button 
                    key={item}
                    onClick={() => {
                      if (item === 'Dashboard') {
                        setView('dashboard');
                        return;
                      }
                      if (view !== 'home') setView('home');
                      const id = item.toLowerCase() === 'home' ? 'hero' : item.toLowerCase();
                      setTimeout(() => {
                        const el = document.getElementById(id);
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }, view !== 'home' ? 100 : 0);
                    }}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className={`${(item === 'Home' && view === 'home') || (item === 'Dashboard' && view === 'dashboard') ? 'text-foreground font-medium' : 'text-muted'} transition-colors hover:text-foreground cursor-pointer bg-transparent border-none p-0`}
                  >
                    {item}
                  </motion.button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-black/5">
                <img src={user.photoURL || ''} className="w-6 h-6 rounded-full" alt="User" />
                <span className="text-xs font-medium hidden sm:inline">{user.displayName?.split(' ')[0]}</span>
                <button onClick={logout} className="p-1 hover:text-red-500 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
              
              {view === 'home' && (
                <motion.button 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileHover={{ scale: 1.03 }}
                  onClick={() => {
                    if (gameState) {
                      setView('map');
                    } else {
                      document.getElementById('start-form')?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  className="bg-foreground text-white rounded-full px-6 py-2.5 text-sm transition-all shadow-lg"
                >
                  {gameState ? 'Resume Simulation' : 'Begin Simulation'}
                </motion.button>
              )}
            </div>
          </div>
        </nav>
      )}

      {/* Dashboard (Sticky below nav if game started) */}
      {gameState && view !== 'home' && (
        <motion.div 
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="fixed top-20 left-0 right-0 z-40 p-4 bg-white/80 backdrop-blur-md border-b border-black/5"
        >
          <div className="max-w-7xl mx-auto flex justify-center gap-12">
            <Metric icon={<Coins className="text-foreground w-4 h-4" />} label="Budget" value={`$${(gameState.budget || 0).toLocaleString()}`} />
            <Metric icon={<Users className="text-foreground w-4 h-4" />} label="Trust" value={`${gameState.trust}%`} />
            <Metric icon={<Zap className="text-foreground w-4 h-4" />} label="Impact" value={gameState.impact} />
            <Metric 
              icon={<TrendingUp className="text-foreground w-4 h-4" />} 
              label="Performance" 
              value={(gameState.performanceHistory?.length || 0) > 0 
                ? `${Math.round(gameState.performanceHistory.reduce((a, b) => a + b, 0) / gameState.performanceHistory.length)}%`
                : '0%'
              } 
            />
          </div>
        </motion.div>
      )}

      <main className={`${view === 'home' ? '' : 'pt-48 pb-20 px-4 max-w-5xl mx-auto'}`}>
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <HomeView onStart={handleStart} loading={loading} />
          )}

          {view === 'dashboard' && user && (
            <DashboardView 
              user={user} 
              gameState={gameState} 
              proposalStatus={proposalStatus} 
              onBack={() => setView(gameState ? 'map' : 'home')} 
            />
          )}

          {view === 'map' && gameState && (
            <MapView 
              gameState={gameState} 
              onSelectStage={(stage) => {
                setSelectedStage(stage);
                if (gameState) {
                  const updatedState = { ...gameState, stageStatus: 'overview' as const };
                  setGameState(updatedState);
                  setView('stage');
                  saveUserProgress(user.uid, String(gameState.currentStage), { gameState: updatedState });
                }
              }} 
            />
          )}

          {view === 'stage' && selectedStage && gameState && (
            <>
              {gameState.stageStatus === 'overview' && (
                <StageDetailView 
                  stage={selectedStage} 
                  onStartSimulation={handleStartSimulation}
                  onBack={() => setView('map')}
                  onSkip={nextStage}
                />
              )}

              {gameState.stageStatus === 'simulation' && (
                <>
                  {selectedStage.type === 'video-pitch' && (
                    <VideoPitchView 
                      stage={selectedStage}
                      feedback={videoFeedback}
                      onSubmit={handleVideoPitchSubmit}
                      onNext={nextStage}
                      onRetry={() => handleRetryStage('video')}
                      loading={loading}
                      evaluationError={pitchError}
                    />
                  )}
                  {selectedStage.type === 'pitch' && (
                    <MockPitchView 
                      stage={selectedStage}
                      feedback={mockPitchFeedback}
                      onSubmit={handleMockPitchSubmit}
                      onNext={nextStage}
                      onRetry={() => handleRetryStage('mock')}
                      loading={loading}
                    />
                  )}
                  {selectedStage.type === 'ppt-pitch' && (
                    <PptPitchView 
                      stage={selectedStage}
                      feedback={pptFeedback}
                      onSubmit={handlePptPitchSubmit}
                      onNext={nextStage}
                      onRetry={() => handleRetryStage('ppt')}
                      loading={loading}
                    />
                  )}
                  {selectedStage.type === 'normal' && (
                    <SimulationView 
                      stage={selectedStage}
                      result={simulationResult}
                      onChoice={handleChoice}
                      onNext={nextStage}
                    />
                  )}
                  {selectedStage.type === 'crisis' && (
                    <SimulationView 
                      stage={selectedStage}
                      result={simulationResult}
                      onChoice={handleChoice}
                      onNext={nextStage}
                    />
                  )}
                  {/* Final Pitch if it's the last stage and simulation is done */}
                  {gameState.currentStage === gameState.stages.length && (
                    <PitchView 
                      pitchText={pitchText}
                      setPitchText={setPitchText}
                      onSubmit={handlePitchSubmit}
                      loading={loading}
                    />
                  )}
                </>
              )}

              {gameState.stageStatus === 'feedback' && (
                <>
                  {selectedStage.type === 'video-pitch' && videoFeedback && (
                    <VideoPitchView 
                      stage={selectedStage}
                      feedback={videoFeedback}
                      onSubmit={handleVideoPitchSubmit}
                      onNext={nextStage}
                      onRetry={() => handleRetryStage('video')}
                      loading={loading}
                      evaluationError={pitchError}
                    />
                  )}
                  {selectedStage.type === 'pitch' && mockPitchFeedback && (
                    <MockPitchView 
                      stage={selectedStage}
                      feedback={mockPitchFeedback}
                      onSubmit={handleMockPitchSubmit}
                      onNext={nextStage}
                      onRetry={() => handleRetryStage('mock')}
                      loading={loading}
                    />
                  )}
                  {selectedStage.type === 'ppt-pitch' && pptFeedback && (
                    <PptPitchView 
                      stage={selectedStage}
                      feedback={pptFeedback}
                      onSubmit={handlePptPitchSubmit}
                      onNext={nextStage}
                      onRetry={() => handleRetryStage('ppt')}
                      loading={loading}
                    />
                  )}
                </>
              )}
            </>
          )}

          {view === 'result' && gameState?.pitchFeedback && (
            <ResultView feedback={gameState.pitchFeedback} onRestart={() => window.location.reload()} />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode, label: string, value: string | number }) {
  return (
    <motion.div 
      key={String(value)}
      initial={{ scale: 1.1, color: '#000' }}
      animate={{ scale: 1, color: 'inherit' }}
      className="flex items-center gap-3"
    >
      <div className="p-1.5 bg-black/5 rounded-lg">{icon}</div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-widest text-muted font-bold">{label}</span>
        <span className="text-sm font-medium">{value}</span>
      </div>
    </motion.div>
  );
}

function HomeView({ onStart, loading }: { onStart: (idea: string, budget: string) => void, loading: boolean }) {
  const [idea, setIdea] = useState('');
  const [budget, setBudget] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [opacity, setOpacity] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 3D Parallax Effect with Spring Smoothing
  const mouseX = useSpring(0, { stiffness: 50, damping: 20 });
  const mouseY = useSpring(0, { stiffness: 50, damping: 20 });

  const handleMouseMove = (e: MouseEvent) => {
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;
    const x = (clientX / innerWidth - 0.5) * 30; // Increased range
    const y = (clientY / innerHeight - 0.5) * 30;
    mouseX.set(x);
    mouseY.set(y);
  };

  const rotateX = useTransform(mouseY, (v) => -v * 0.5);
  const rotateY = useTransform(mouseX, (v) => v * 0.5);
  const bgRotateX = useTransform(mouseY, (v) => v * 0.2);
  const bgRotateY = useTransform(mouseX, (v) => -v * 0.2);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let frameId: number;
    const fadeDuration = 0.5;

    const checkTime = () => {
      const currentTime = video.currentTime;
      const duration = video.duration;

      if (duration > 0) {
        if (currentTime < fadeDuration) {
          setOpacity(currentTime / fadeDuration);
        } else if (currentTime > duration - fadeDuration) {
          setOpacity((duration - currentTime) / fadeDuration);
        } else {
          setOpacity(1);
        }
      }
      frameId = requestAnimationFrame(checkTime);
    };

    const handleEnded = () => {
      setOpacity(0);
      setTimeout(() => {
        video.currentTime = 0;
        video.play();
      }, 100);
    };

    video.addEventListener('ended', handleEnded);
    frameId = requestAnimationFrame(checkTime);

    return () => {
      video.removeEventListener('ended', handleEnded);
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative min-h-screen w-full overflow-x-hidden flex flex-col items-center perspective-1000"
    >
      {/* Hero Section */}
      <section id="hero" className="relative w-full min-h-screen flex flex-col items-center">
        {/* Background Video Layer */}
        <motion.div 
          className="absolute inset-0 z-0 pointer-events-none" 
          style={{ 
            top: '300px',
            rotateX: bgRotateX,
            rotateY: bgRotateY,
            scale: 1.1
          }}
        >
          <video
            ref={videoRef}
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4"
            muted
            playsInline
            autoPlay
            className="w-full h-full object-cover transition-opacity duration-100"
            style={{ opacity }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-white via-transparent to-white" />
        </motion.div>

        {/* Hero Content */}
        <motion.div 
          className="relative z-10 flex flex-col items-center justify-center text-center px-6 w-full" 
          animate={{
            y: [0, -15, 0], // Subtle floating animation
          }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          style={{ 
            paddingTop: '16rem', 
            paddingBottom: '12rem',
            rotateX,
            rotateY,
            transformStyle: 'preserve-3d'
          }}
        >
          <motion.h1 
            initial={{ opacity: 0, y: 40, rotateX: 20 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="text-5xl sm:text-7xl md:text-8xl max-w-7xl font-serif font-normal leading-[1.1] tracking-tight text-foreground"
            style={{ translateZ: '100px' }} // Increased depth
          >
            Don’t just learn <span className="text-muted italic">startups</span> — experience <span className="text-muted italic">them.</span>
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="text-base sm:text-lg max-w-2xl mt-8 leading-relaxed text-muted"
            style={{ translateZ: '60px' }} // Increased depth
          >
            Master the art of social innovation. Our immersive simulation puts you in the driver's seat of a high-impact venture, where every decision shapes the future.
          </motion.p>

            <motion.button 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.05, translateZ: '120px' }} // Increased depth
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            onClick={() => document.getElementById('start-form')?.scrollIntoView({ behavior: 'smooth' })}
            className="bg-foreground text-white rounded-full px-14 py-5 text-base mt-12 transition-all shadow-xl shadow-black/5"
            style={{ translateZ: '80px' }} // Increased depth
          >
            Begin Simulation
          </motion.button>
        </motion.div>
      </section>

      {/* About Section */}
      <section id="about" className="w-full max-w-7xl px-8 py-32 space-y-20">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <motion.div 
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="space-y-8"
          >
            <h2 className="text-5xl font-serif tracking-tight">What is <span className="italic text-muted">StartupSim?</span></h2>
            <p className="text-lg text-muted leading-relaxed">
              StartupSim is an experiential learning platform designed to bridge the gap between theory and execution in social entrepreneurship. We believe that the best way to learn is by doing—navigating real-world complexities, managing stakeholder expectations, and making critical decisions under pressure.
            </p>
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                <h4 className="text-3xl font-serif">100%</h4>
                <p className="text-xs uppercase tracking-widest text-muted font-bold">Experiential</p>
              </div>
              <div className="space-y-2">
                <h4 className="text-3xl font-serif">AI-Driven</h4>
                <p className="text-xs uppercase tracking-widest text-muted font-bold">Personalized</p>
              </div>
            </div>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative aspect-square rounded-3xl overflow-hidden shadow-2xl"
          >
            <img 
              src="https://picsum.photos/seed/innovation/800/800" 
              alt="Social Innovation" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </motion.div>
        </div>
      </section>

      {/* Simulation Phases Section */}
      <section id="simulation" className="w-full bg-black/[0.02] py-32">
        <div className="max-w-7xl mx-auto px-8 space-y-20">
          <div className="text-center space-y-4">
            <h2 className="text-5xl font-serif tracking-tight">Implementation <span className="italic text-muted">Phases</span></h2>
            <p className="text-muted max-w-2xl mx-auto">Our simulation follows a structured 7-stage journey from initial discovery to the final investor pitch.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: "Problem Discovery", desc: "Identify deep-rooted social challenges.", img: "discovery" },
              { title: "Stakeholder Mapping", desc: "Engage with NGOs and governments.", img: "network" },
              { title: "Solution Design", desc: "Build sustainable, scalable models.", img: "design" },
              { title: "Impact Metrics", desc: "Define how success is measured.", img: "metrics" },
              { title: "Resource Allocation", desc: "Manage limited budgets effectively.", img: "finance" },
              { title: "Crisis Management", desc: "Navigate unexpected roadblocks.", img: "crisis" },
              { title: "The Pitch", desc: "Present your vision to investors.", img: "pitch" }
            ].map((phase, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="glass-card p-6 space-y-4 hover:border-foreground/20 transition-all group"
              >
                <div className="aspect-video rounded-xl overflow-hidden bg-black/5">
                  <img 
                    src={`https://picsum.photos/seed/${phase.img}/400/225`} 
                    alt={phase.title} 
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Phase 0{i+1}</span>
                  <h3 className="text-xl font-serif">{phase.title}</h3>
                  <p className="text-sm text-muted">{phase.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Start Form Section Integrated Here */}
          <div id="start-form" className="flex flex-col items-center pt-20">
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="w-full max-w-xl"
            >
              <div className="glass-card p-10 space-y-8 border-black/10 shadow-2xl shadow-black/5 hover:shadow-black/10 transition-shadow bg-white">
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-serif">Initiate Simulation</h2>
                  <p className="text-sm text-muted">Define your vision to begin the execution cycle.</p>
                </div>
                
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Startup Idea</label>
                    <textarea 
                      value={idea}
                      onChange={(e) => setIdea(e.target.value)}
                      placeholder="e.g. AI-powered sustainable fashion marketplace"
                      className="w-full bg-black/5 border border-black/5 rounded-2xl p-4 focus:outline-none focus:border-foreground transition-colors h-32 resize-none text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Initial Budget ($)</label>
                    <input 
                      type="text"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="e.g. 50000"
                      className="w-full bg-black/5 border border-black/5 rounded-2xl p-4 focus:outline-none focus:border-foreground transition-colors text-sm"
                    />
                  </div>
                  <button 
                    onClick={() => onStart(idea, budget)}
                    disabled={loading || !idea || !budget}
                    className="w-full bg-foreground text-white font-medium py-4 rounded-2xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>Start Simulation <ChevronRight className="w-4 h-4" /></>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Impact Section */}
      <section id="impact" className="w-full max-w-7xl px-8 py-32 space-y-20">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative aspect-video rounded-3xl overflow-hidden shadow-2xl order-2 md:order-1"
          >
            <img 
              src="https://picsum.photos/seed/impact/1200/675" 
              alt="Social Impact" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="space-y-8 order-1 md:order-2"
          >
            <h2 className="text-5xl font-serif tracking-tight">Measuring <span className="italic text-muted">Success</span></h2>
            <p className="text-lg text-muted leading-relaxed">
              In social innovation, profit is only half the story. Our simulation tracks your impact score alongside your budget. We challenge you to build ventures that are not only financially viable but also create measurable positive change in the world.
            </p>
            <ul className="space-y-4">
              {["Sustainable Development Goals", "Community Trust Building", "Scalable Social Models"].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-foreground font-medium">
                  <CheckCircle2 className="w-5 h-5 text-foreground" /> {item}
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* Contact Section */}
      <footer id="contact" className="w-full border-t border-black/5 py-20">
        <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-12">
          <div className="space-y-4 text-center md:text-left">
            <h3 className="text-3xl font-serif">StartupSim®</h3>
            <p className="text-sm text-muted max-w-xs">Empowering the next generation of social innovators through immersive simulation.</p>
          </div>
          <div className="flex gap-12 text-sm">
            <div className="space-y-4">
              <h4 className="font-bold uppercase tracking-widest text-[10px] text-muted">Platform</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-muted transition-colors">Simulation</a></li>
                <li><a href="#" className="hover:text-muted transition-colors">Methodology</a></li>
                <li><a href="#" className="hover:text-muted transition-colors">Pricing</a></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-bold uppercase tracking-widest text-[10px] text-muted">Company</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-muted transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-muted transition-colors">Impact Report</a></li>
                <li><a href="#" className="hover:text-muted transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-8 pt-20 text-center">
          <p className="text-[10px] uppercase tracking-widest text-muted font-bold">© 2026 StartupSim AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function MapView({ gameState, onSelectStage }: { gameState: GameState, onSelectStage: (stage: Stage) => void }) {
  const phases = ['Idea', 'Resources', 'Investors', 'Growth', 'Scale'] as const;
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);
  
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative min-h-[1200px] py-20 bg-[#fcfcfc]"
    >
      {/* Subtle Background Pattern */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      
      <div className="text-center space-y-4 mb-20 relative z-10">
        <h2 className="text-5xl font-serif tracking-tight">The Founder's <span className="italic text-muted">Path</span></h2>
        <p className="text-muted max-w-lg mx-auto">A professional journey from idea to global scale. Master each stage to unlock the next.</p>
      </div>

      <div className="max-w-4xl mx-auto relative">
        {/* Continuous Winding Path Line */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ zIndex: 0 }}>
          <path
            d={gameState.stages.map((_, i) => {
              const x = 50 + (i % 2 === 0 ? 25 : -25);
              const y = i * 200 + 100;
              return `${i === 0 ? 'M' : 'L'} ${x}% ${y}`;
            }).join(' ')}
            fill="none"
            stroke="rgba(0,0,0,0.05)"
            strokeWidth="4"
            strokeDasharray="12 12"
          />
        </svg>

        <div className="space-y-0 relative z-10">
          {phases.map((phase, pIdx) => {
            const phaseStages = gameState.stages.filter(s => s.phase === phase);
            if (phaseStages.length === 0) return null;

            return (
              <div key={phase} className="space-y-12 mb-32">
                <div className="flex items-center gap-6 sticky top-24 bg-white/80 backdrop-blur-sm py-4 z-20">
                  <div className="h-px flex-1 bg-black/5" />
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{phase} Phase</h3>
                  <div className="h-px flex-1 bg-black/5" />
                </div>

                <div className="space-y-32">
                  {phaseStages.map((stage, sIdx) => {
                    const globalIndex = gameState.stages.findIndex(s => s.id === stage.id);
                    const isLocked = stage.id > gameState.currentStage;
                    const isCompleted = stage.id < gameState.currentStage;
                    const isCurrent = stage.id === gameState.currentStage;
                    const xOffset = globalIndex % 2 === 0 ? '25%' : '-25%';

                    return (
                      <div 
                        key={stage.id} 
                        ref={isCurrent ? activeRef : null}
                        className="flex justify-center"
                        style={{ transform: `translateX(${xOffset})` }}
                      >
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          whileInView={{ scale: 1, opacity: 1 }}
                          whileHover={!isLocked ? { y: -12, scale: 1.05, rotate: globalIndex % 2 === 0 ? 2 : -2 } : {}}
                          viewport={{ once: true }}
                          transition={{ type: 'spring', delay: sIdx * 0.1, stiffness: 260, damping: 20 }}
                          onClick={() => !isLocked && onSelectStage(stage)}
                          className={`
                            group relative w-44 h-44 rounded-[3.5rem] flex items-center justify-center cursor-pointer transition-all duration-500
                            ${isLocked ? 'bg-gray-50 grayscale opacity-40 cursor-not-allowed border-dashed border-2 border-gray-200' : 'bg-white shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-black/5'}
                            ${isCurrent ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-[0_20px_50px_rgba(37,99,235,0.4)] ring-8 ring-blue-50' : ''}
                            ${isCompleted ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_20px_50px_rgba(16,185,129,0.3)]' : ''}
                          `}
                        >
                          {isCurrent && (
                            <motion.div 
                              layoutId="pulse"
                              className="absolute -inset-8 bg-blue-500/10 rounded-[4.5rem] -z-10"
                              animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.2, 0.6] }}
                              transition={{ duration: 3, repeat: Infinity }}
                            />
                          )}

                          <div className="flex flex-col items-center gap-1 relative z-10">
                            <span className={`text-6xl font-black font-serif leading-none ${isCompleted || isCurrent ? 'text-white drop-shadow-md' : 'text-foreground opacity-20'}`}>{globalIndex + 1}</span>
                            <div className="flex gap-1.5 mt-1">
                              {isLocked && <Lock className="w-6 h-6 text-muted/30" />}
                              {isCompleted && <CheckCircle2 className="w-6 h-6 text-white" />}
                              {stage.type === 'video-pitch' && <Video className={`w-6 h-6 ${isCompleted || isCurrent ? 'text-white' : 'text-muted'}`} />}
                              {stage.type === 'pitch' && <TrendingUp className={`w-6 h-6 ${isCompleted || isCurrent ? 'text-white' : 'text-muted'}`} />}
                              {stage.type === 'ppt-pitch' && <Building2 className={`w-6 h-6 ${isCompleted || isCurrent ? 'text-white' : 'text-muted'}`} />}
                              {stage.type === 'crisis' && <AlertTriangle className="w-6 h-6 text-red-400" />}
                            </div>
                          </div>

                          {/* Hover Card */}
                          <div className="absolute left-full ml-8 w-64 p-6 bg-white rounded-3xl shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all translate-x-4 group-hover:translate-x-0 z-50 border border-black/5">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">{stage.type}</div>
                            <h4 className="text-lg font-serif mb-2 text-foreground">{stage.name}</h4>
                            <p className="text-xs text-muted leading-relaxed">{stage.objective}</p>
                          </div>

                          {isCurrent && (
                            <div className="absolute -top-6 -right-6 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-full shadow-xl animate-bounce z-20 border-2 border-white">
                              Active
                            </div>
                          )}

                          {isCompleted && (
                            <div className="absolute -top-6 -right-6 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-full shadow-xl z-20 border-2 border-white">
                              Done
                            </div>
                          )}
                        </motion.div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function StageDetailView({ stage, onStartSimulation, onBack, onSkip }: { stage: Stage, onStartSimulation: () => void, onBack: () => void, onSkip: () => void }) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card p-12 space-y-16"
    >
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="text-xs font-bold text-muted hover:text-foreground flex items-center gap-2 transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180" /> BACK TO SIMULATION MAP
        </button>
        <button onClick={onSkip} className="text-xs font-bold text-muted hover:text-red-500 flex items-center gap-2 transition-colors">
          SKIP STAGE <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-8">
        <div className="flex items-center gap-6">
          <div className="p-6 rounded-3xl bg-black/5">
            <Target className="w-12 h-12 text-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Stage {stage.id}</span>
              <span className="text-[10px] font-bold text-foreground bg-black/5 px-2 py-0.5 rounded-full uppercase tracking-widest">{stage.phase} Phase</span>
            </div>
            <h2 className="text-5xl font-serif tracking-tight">{stage.name}</h2>
          </div>
        </div>
        <p className="text-3xl text-muted font-serif italic leading-relaxed max-w-3xl">"{stage.objective}"</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-12">
          {/* Cost Estimates */}
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-8 rounded-[2.5rem] bg-black/5 border border-black/5 space-y-4">
              <div className="flex items-center gap-3">
                <Coins className="w-5 h-5 text-muted" />
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Real-World Cost Estimate</h4>
              </div>
              <p className="text-xl font-serif italic text-foreground leading-relaxed">
                {stage.realWorldCostEstimate || "Cost varies based on execution and market conditions."}
              </p>
            </div>
            <div className="p-8 rounded-[2.5rem] bg-red-50 border border-red-100 space-y-4">
              <div className="flex items-center gap-3">
                <TrendingDown className="w-5 h-5 text-red-400" />
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-red-400">Simulation Attempt Cost</h4>
              </div>
              <p className="text-3xl font-serif text-red-600 leading-none">
                -${(stage.simulationCost || 0).toLocaleString()}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-400 opacity-60">Deducted per attempt/retry</p>
            </div>
          </div>

          {/* Real World Resources */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-muted" />
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Real-World Resources</h4>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              {stage.realWorldResources.map((res, i) => (
                <div key={i} className="p-6 rounded-3xl bg-black/[0.02] border border-black/5 space-y-4">
                  <h5 className="font-serif text-lg">{res.title}</h5>
                  <p className="text-sm text-muted leading-relaxed">{res.description}</p>
                  {res.link && (
                    <a 
                      href={res.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-bold hover:underline"
                    >
                      Learn More <Globe className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Government Funding */}
          {stage.governmentFundingGuide && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-muted" />
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Government Funding Portal</h4>
              </div>
              <div className="p-10 rounded-[3rem] bg-foreground text-white space-y-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
                
                <div className="space-y-4 relative z-10">
                  <div className="inline-block px-3 py-1 rounded-full bg-white/10 text-[8px] font-bold uppercase tracking-widest">Recommended Program</div>
                  <h5 className="text-3xl font-serif leading-tight">{stage.governmentFundingGuide.programName}</h5>
                </div>

                <div className="grid md:grid-cols-2 gap-10 relative z-10">
                  <div className="space-y-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">Eligibility Criteria</div>
                    <p className="text-sm leading-relaxed opacity-90 font-serif italic">"{stage.governmentFundingGuide.eligibility}"</p>
                  </div>
                  <div className="space-y-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">Submission Strategy</div>
                    <p className="text-sm leading-relaxed opacity-90">{stage.governmentFundingGuide.submissionTips}</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/10 flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-60">
                    <CheckCircle2 className="w-4 h-4" /> Ready for Application
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                    Project-Specific Guide
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-12">
          {/* Tasks */}
          <div className="space-y-6">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Actionable Tasks</h4>
            <ul className="space-y-4">
              {stage.tasks.map((task, i) => (
                <li key={i} className="flex items-start gap-4 text-foreground/80">
                  <div className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
                  </div>
                  <span className="text-lg leading-tight">{task}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Start Button */}
          <div className="bg-black/5 rounded-3xl p-10 flex flex-col justify-center items-center text-center gap-6">
            <Zap className="w-12 h-12 text-foreground" />
            <div className="space-y-2">
              <h4 className="text-xl font-serif">Ready to Simulate?</h4>
              <p className="text-sm text-muted">Test your skills in a high-stakes scenario.</p>
            </div>
            <button 
              onClick={onStartSimulation}
              className="w-full bg-foreground text-white font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all flex flex-col items-center justify-center gap-1"
            >
              <div className="flex items-center gap-2 text-xl font-serif">
                {stage.type === 'video-pitch' ? 'Start Video Pitch' : 
                 stage.type === 'ppt-pitch' ? 'Start Deck Pitch' :
                 stage.type === 'pitch' ? 'Start Mock Pitch' : 'Initiate Simulation'}
                <Zap className="w-5 h-5" />
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                Deducts ${(stage.simulationCost || 0).toLocaleString()} from Budget
              </div>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function SimulationView({ stage, result, onChoice, onNext }: { 
  stage: Stage, 
  result: string | null, 
  onChoice: (impact: { budget: number; trust: number; impact: number }, feedback: string) => void,
  onNext: () => void
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass-card p-12 space-y-12"
    >
      <div className="flex items-center gap-3 text-muted">
        <Zap className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-widest">Simulation Scenario</span>
      </div>

      <div className="space-y-10">
        <h2 className="text-4xl font-serif leading-tight tracking-tight">{stage.simulation.scenario}</h2>
        
        {!result ? (
          <div className="grid gap-4">
            {stage.simulation.options.map((option, i) => (
              <button 
                key={i}
                onClick={() => onChoice(option.impact, option.feedback)}
                className="text-left p-8 rounded-2xl bg-black/5 border border-transparent hover:border-foreground/20 hover:bg-black/[0.08] transition-all group flex justify-between items-center"
              >
                <span className="text-lg font-medium pr-8">{option.text}</span>
                <ChevronRight className="w-6 h-6 text-foreground opacity-0 group-hover:opacity-100 transition-all shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-10"
          >
            <div className="p-10 rounded-3xl bg-black/5 text-2xl font-serif italic text-muted leading-relaxed">
              "{result}"
            </div>
            <button 
              onClick={onNext}
              className="w-full bg-foreground text-white font-medium py-5 rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 text-lg"
            >
              Continue Simulation <ChevronRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function PitchView({ pitchText, setPitchText, onSubmit, loading }: { 
  pitchText: string, 
  setPitchText: (t: string) => void, 
  onSubmit: () => void,
  loading: boolean
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-12 space-y-12"
    >
      <div className="text-center space-y-6">
        <div className="inline-block p-6 rounded-3xl bg-black/5">
          <TrendingUp className="w-14 h-14 text-foreground" />
        </div>
        <h2 className="text-6xl font-serif tracking-tight">The Final Pitch</h2>
        <p className="text-muted max-w-2xl mx-auto text-lg">
          You've completed the simulation. Now, convince a social impact investor that your venture is worth their capital.
        </p>
      </div>

      <div className="space-y-6">
        <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Your Pitch</label>
        <textarea 
          value={pitchText}
          onChange={(e) => setPitchText(e.target.value)}
          placeholder="Describe your vision, business model, and why you'll win..."
          className="w-full bg-black/5 border border-black/5 rounded-3xl p-8 focus:outline-none focus:border-foreground transition-colors h-80 resize-none text-xl font-serif"
        />
        <button 
          onClick={onSubmit}
          disabled={loading || !pitchText}
          className="w-full bg-foreground text-white font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 text-2xl"
        >
          {loading ? (
            <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>Submit to Investor <Send className="w-6 h-6" /></>
          )}
        </button>
      </div>
    </motion.div>
  );
}

function VideoPitchView({ stage, feedback, onSubmit, onNext, onRetry, loading, evaluationError }: { 
  stage: Stage, 
  feedback: { score: number, feedback: string, questions: string[], isBad?: boolean } | null,
  onSubmit: (base64: string, mimeType: string) => void, 
  onNext: () => void,
  onRetry: () => void,
  loading: boolean,
  evaluationError?: string | null
}) {
  const [recording, setRecording] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [showTips, setShowTips] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
      }
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setVideoBlob(blob);
        setVideoUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setRecording(true);
      setShowTips(false);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setError("Camera and microphone access are required for the video pitch. Please check your browser permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const handleSubmit = async () => {
    if (!videoBlob) return;
    const reader = new FileReader();
    reader.readAsDataURL(videoBlob);
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      onSubmit(base64, 'video/webm');
    };
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-12 space-y-12 max-w-6xl mx-auto"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-muted">
          <Video className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Mock Video Pitch</span>
        </div>
        <button 
          onClick={() => setShowTips(!showTips)}
          className="text-[10px] font-bold uppercase tracking-widest text-muted hover:text-foreground transition-colors"
        >
          {showTips ? 'Hide Tips' : 'Show Pitch Tips'}
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-serif tracking-tight">{stage.simulation.scenario}</h2>
            <p className="text-muted text-lg">Record a 30-60 second pitch. The AI Investor will analyze your body language, tone, and content.</p>
            {(error || evaluationError) && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm"
              >
                <AlertTriangle className="w-5 h-5 shrink-0" />
                {error || evaluationError}
              </motion.div>
            )}
          </div>

          {!feedback ? (
            <div className="space-y-8">
              <div className="relative aspect-video bg-black rounded-[2.5rem] overflow-hidden border-8 border-black/5 shadow-2xl">
                {videoUrl ? (
                  <video src={videoUrl} controls className="w-full h-full object-cover" />
                ) : (
                  <video ref={videoPreviewRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                )}
                
                {recording && (
                  <div className="absolute top-8 left-8 flex items-center gap-3 bg-red-500 text-white px-4 py-2 rounded-full text-xs font-bold uppercase animate-pulse shadow-lg">
                    <div className="w-2.5 h-2.5 bg-white rounded-full" /> Recording Live
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                {!videoUrl ? (
                  !recording ? (
                    <button 
                      onClick={startRecording}
                      className="flex-1 bg-foreground text-white font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 text-xl shadow-xl"
                    >
                      <Play className="w-6 h-6" /> Start Recording
                    </button>
                  ) : (
                    <button 
                      onClick={stopRecording}
                      className="flex-1 bg-red-500 text-white font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 text-xl shadow-xl"
                    >
                      <Square className="w-6 h-6" /> Stop Recording
                    </button>
                  )
                ) : (
                  <>
                    <button 
                      onClick={() => { setVideoUrl(null); setVideoBlob(null); }}
                      className="flex-1 bg-black/5 text-foreground font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 text-xl"
                    >
                      <RefreshCw className="w-6 h-6" /> Retake
                    </button>
                    <button 
                      onClick={handleSubmit}
                      disabled={loading}
                      className="flex-[2] bg-foreground text-white font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 text-xl shadow-xl"
                    >
                      {loading ? (
                        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>Submit to AI Investor <Send className="w-6 h-6" /></>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-12"
            >
              <div className="flex justify-between items-end">
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Investor Score</div>
                  <div className="text-9xl font-serif leading-none">{feedback.score}<span className="text-2xl text-muted">/100</span></div>
                </div>
                <div className="text-right space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Verdict</div>
                  <div className={`text-3xl font-serif ${feedback.isBad ? 'text-red-500' : 'text-green-600'}`}>
                    {feedback.isBad ? 'Critical Rejection' : 'Strong Interest'}
                  </div>
                </div>
              </div>
              
              <div className={`p-12 rounded-[3rem] space-y-6 ${feedback.isBad ? 'bg-red-50 border border-red-100' : 'bg-black/5'}`}>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Investor's Internal Notes</h4>
                <p className="text-2xl leading-relaxed text-muted font-serif italic">"{feedback.feedback}"</p>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Tough Questions</h4>
                  <div className="space-y-4">
                    {feedback.questions.map((q, i) => (
                      <div key={i} className="p-6 rounded-2xl border border-black/5 text-muted italic text-sm bg-white/50">
                        {q}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-black/5 p-10 rounded-[2.5rem] space-y-6">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Strategic Advice</h4>
                  <p className="text-sm text-muted leading-relaxed">
                    {feedback.isBad 
                      ? "The investor found significant flaws in your delivery or model. You can retry to improve your score, or continue with the current results."
                      : "You've successfully built trust. The investor sees potential. Double down on your current traction."}
                  </p>
                  <div className="flex flex-col gap-3">
                    {feedback.isBad && (
                      <button 
                        onClick={onRetry}
                        className="w-full bg-red-500 text-white font-medium py-5 rounded-2xl hover:scale-[1.02] transition-all shadow-xl flex flex-col items-center justify-center gap-1"
                      >
                        <div className="flex items-center gap-2">
                          <RefreshCw className="w-5 h-5" /> Retry Stage
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                          Deducts ${(stage.simulationCost || 0).toLocaleString()} from Budget
                        </div>
                      </button>
                    )}
                    <button 
                      onClick={onNext}
                      className={`w-full ${feedback.isBad ? 'bg-black/10 text-foreground' : 'bg-foreground text-white'} font-medium py-5 rounded-2xl hover:scale-[1.02] transition-all shadow-xl`}
                    >
                      {feedback.isBad ? 'Continue Anyway' : 'Continue Journey'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        <AnimatePresence>
          {showTips && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8"
            >
              <div className="p-8 rounded-[2rem] bg-black/5 space-y-6">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Pitch Teleprompter</h4>
                <div className="space-y-4 text-sm text-muted leading-relaxed font-serif italic">
                  <p>1. Hook them in the first 10 seconds.</p>
                  <p>2. Clearly state the problem you're solving.</p>
                  <p>3. Explain why your solution is unique.</p>
                  <p>4. Show the impact/traction you've made.</p>
                  <p>5. End with a clear ask.</p>
                </div>
              </div>

              <div className="p-8 rounded-[2rem] border border-black/5 space-y-6">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Investor Persona</h4>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-black/5 flex items-center justify-center">
                    <Users className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Critical Angel</div>
                    <div className="text-[10px] text-muted uppercase">High Standards</div>
                  </div>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  This investor values data over hype. Be precise, be confident, and don't over-promise.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function LoginView({ onLogin, loading }: { onLogin: () => void, loading: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#f5f5f0]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-12 max-w-md w-full text-center space-y-8"
      >
        <div className="w-20 h-20 bg-foreground text-white rounded-3xl flex items-center justify-center mx-auto shadow-2xl">
          <Rocket className="w-10 h-10" />
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-serif tracking-tight">Welcome Back</h1>
          <p className="text-muted leading-relaxed">Sign in to track your startup journey and save your progress across all stages.</p>
        </div>
        <button 
          onClick={onLogin}
          disabled={loading}
          className="w-full bg-foreground text-white font-medium py-5 rounded-2xl hover:scale-[1.02] transition-all shadow-xl flex items-center justify-center gap-3 text-lg"
        >
          {loading ? (
            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              Continue with Google
            </>
          )}
        </button>
      </motion.div>
    </div>
  );
}

function DashboardView({ user, gameState, proposalStatus, onBack }: { 
  user: User, 
  gameState: GameState | null, 
  proposalStatus: { status: string, review: string } | null,
  onBack: () => void 
}) {
  return (
    <div className="min-h-screen p-8 md:p-16 space-y-12 bg-[#f5f5f0]">
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="flex items-center gap-2 text-muted hover:text-foreground transition-colors">
          <ChevronRight className="w-5 h-5 rotate-180" /> Back to Journey
        </button>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm font-bold">{user.displayName}</div>
            <div className="text-[10px] text-muted uppercase tracking-widest">{user.email}</div>
          </div>
          <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border border-black/5" alt="Profile" />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="glass-card p-10 space-y-8">
            <div className="flex items-center gap-3 text-muted">
              <LayoutDashboard className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Progress Overview</span>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8">
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Current Stage</div>
                <div className="text-4xl font-serif">{gameState?.currentStage || 0}<span className="text-sm text-muted">/{gameState?.stages.length || 5}</span></div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Total Impact</div>
                <div className="text-4xl font-serif">{gameState?.impact || 0}</div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Investor Trust</div>
                <div className="text-4xl font-serif">{gameState?.trust || 0}%</div>
              </div>
            </div>

            <div className="h-2 w-full bg-black/5 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${((gameState?.currentStage || 0) / (gameState?.stages.length || 5)) * 100}%` }}
                className="h-full bg-foreground"
              />
            </div>
          </div>

          <div className="glass-card p-10 space-y-8">
            <div className="flex items-center gap-3 text-muted">
              <History className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Stage Breakdown</span>
            </div>
            <div className="space-y-4">
              {gameState?.stages.map((stage, i) => (
                <div key={i} className={`p-6 rounded-2xl border flex items-center justify-between ${i + 1 <= (gameState?.currentStage || 0) ? 'bg-black/5 border-black/5' : 'border-dashed border-black/10 opacity-50'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${i + 1 <= (gameState?.currentStage || 0) ? 'bg-foreground text-white' : 'bg-black/5 text-muted'}`}>
                      {i + 1}
                    </div>
                    <div>
                      <div className="font-medium">{stage.name}</div>
                      <div className="text-[10px] text-muted uppercase tracking-widest">{stage.type}</div>
                    </div>
                  </div>
                  {i + 1 < (gameState?.currentStage || 0) && <CheckCircle2 className="w-5 h-5 text-green-600" />}
                  {i + 1 === (gameState?.currentStage || 0) && <TrendingUp className="w-5 h-5 text-foreground animate-pulse" />}
                  {i + 1 > (gameState?.currentStage || 0) && <Lock className="w-4 h-4 text-muted" />}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className={`glass-card p-10 space-y-8 border-2 ${proposalStatus?.status === 'accepted' ? 'border-green-500/20' : proposalStatus?.status === 'rejected' ? 'border-red-500/20' : 'border-black/5'}`}>
            <div className="flex items-center gap-3 text-muted">
              <Target className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Final Proposal Status</span>
            </div>
            
            <div className="text-center space-y-6">
              {proposalStatus ? (
                <>
                  <div className={`text-5xl font-serif capitalize ${proposalStatus.status === 'accepted' ? 'text-green-600' : proposalStatus.status === 'rejected' ? 'text-red-500' : 'text-muted'}`}>
                    {proposalStatus.status}
                  </div>
                  <div className="p-6 rounded-2xl bg-black/5 text-sm text-muted leading-relaxed italic font-serif">
                    "{proposalStatus.review}"
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="text-4xl font-serif text-muted">Pending</div>
                  <p className="text-xs text-muted leading-relaxed">Complete all stages to receive your final investor review and proposal status.</p>
                </div>
              )}
            </div>
          </div>

          <div className="glass-card p-10 space-y-6 bg-foreground text-white">
            <h4 className="text-[10px] font-bold uppercase tracking-widest opacity-60">Strategic Tip</h4>
            <p className="text-sm leading-relaxed italic font-serif">
              "The best founders don't just build products; they build trust. Your progress reflects your ability to navigate uncertainty with data and conviction."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockPitchView({ stage, feedback, onSubmit, onNext, onRetry, loading }: { 
  stage: Stage, 
  feedback: { score: number, feedback: string, questions: string[], isBad?: boolean } | null,
  onSubmit: (text: string) => void,
  onNext: () => void,
  onRetry: () => void,
  loading: boolean
}) {
  const [text, setText] = useState('');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-12 space-y-12 max-w-4xl mx-auto"
    >
      <div className="flex items-center gap-3 text-muted">
        <Users className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-widest">Mock Pitch Session</span>
      </div>

      <div className="space-y-6">
        <h2 className="text-4xl font-serif tracking-tight">{stage.simulation.scenario}</h2>
        <p className="text-muted text-lg">The investor is waiting. Deliver your pitch for this specific challenge.</p>
      </div>

      {!feedback ? (
        <div className="space-y-6">
          <textarea 
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your pitch here..."
            className="w-full bg-black/5 border border-black/5 rounded-3xl p-8 focus:outline-none focus:border-foreground transition-colors h-64 resize-none text-xl font-serif"
          />
          <button 
            onClick={() => onSubmit(text)}
            disabled={loading || !text}
            className="w-full bg-foreground text-white font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 text-xl"
          >
            {loading ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>Present to Angel Investor <Send className="w-5 h-5" /></>
            )}
          </button>
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-10"
        >
          <div className="flex justify-between items-end">
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Investor Score</div>
              <div className="text-8xl font-serif leading-none">{feedback.score}<span className="text-xl text-muted">/100</span></div>
            </div>
            <div className="text-right space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Verdict</div>
              <div className={`text-2xl font-serif ${feedback.isBad ? 'text-red-500' : 'text-green-600'}`}>
                {feedback.isBad ? 'Critical Rejection' : 'Strong Interest'}
              </div>
            </div>
          </div>
          
          <div className={`p-10 rounded-3xl space-y-6 ${feedback.isBad ? 'bg-red-50 border border-red-100' : 'bg-black/5'}`}>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Investor's Feedback</h4>
            <p className="text-xl leading-relaxed text-muted font-serif italic">"{feedback.feedback}"</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Tough Questions</h4>
              <div className="space-y-4">
                {feedback.questions.map((q, i) => (
                  <div key={i} className="p-6 rounded-2xl border border-black/5 text-muted italic text-sm bg-white/50">
                    {q}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-black/5 p-10 rounded-[2.5rem] flex flex-col justify-center gap-6">
              <p className="text-sm text-muted leading-relaxed">
                {feedback.isBad 
                  ? "The investor was not convinced. You can retry to address the critical feedback, or continue to the next stage."
                  : "Excellent work. You've built significant trust and demonstrated a strong understanding of the challenge."}
              </p>
              <div className="flex flex-col gap-3">
                {feedback.isBad && (
                  <button 
                    onClick={onRetry}
                    className="w-full bg-red-500 text-white font-medium py-5 rounded-2xl hover:scale-[1.02] transition-all shadow-xl flex flex-col items-center justify-center gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-5 h-5" /> Retry Stage
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                      Deducts ${(stage.simulationCost || 0).toLocaleString()} from Budget
                    </div>
                  </button>
                )}
                <button 
                  onClick={onNext}
                  className={`w-full ${feedback.isBad ? 'bg-black/10 text-foreground' : 'bg-foreground text-white'} font-medium py-5 rounded-2xl hover:scale-[1.02] transition-all shadow-xl`}
                >
                  {feedback.isBad ? 'Continue Anyway' : 'Continue Journey'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function PptPitchView({ stage, feedback, onSubmit, onNext, onRetry, loading }: { 
  stage: Stage, 
  feedback: { score: number, feedback: string, questions: string[], isBad?: boolean } | null,
  onSubmit: (text: string) => void,
  onNext: () => void,
  onRetry: () => void,
  loading: boolean
}) {
  const [text, setText] = useState('');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-12 space-y-12 max-w-4xl mx-auto"
    >
      <div className="flex items-center gap-3 text-muted">
        <Building2 className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-widest">Pitch Deck Evaluation</span>
      </div>

      <div className="space-y-6">
        <h2 className="text-4xl font-serif tracking-tight">{stage.simulation.scenario}</h2>
        <p className="text-muted text-lg">Summarize your pitch deck slides (Problem, Solution, Market, Traction, Team). The AI will evaluate the structural integrity and persuasiveness of your deck.</p>
      </div>

      {!feedback ? (
        <div className="space-y-6">
          <textarea 
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Summarize your key slides here (e.g. Slide 1: Problem - Lack of accessible healthcare...)"
            className="w-full bg-black/5 border border-black/5 rounded-3xl p-8 focus:outline-none focus:border-foreground transition-colors h-80 resize-none text-xl font-serif"
          />
          <button 
            onClick={() => onSubmit(text)}
            disabled={loading || !text}
            className="w-full bg-foreground text-white font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 text-xl"
          >
            {loading ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>Submit Deck for Review <Send className="w-5 h-5" /></>
            )}
          </button>
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-10"
        >
          <div className="flex justify-between items-end">
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Deck Score</div>
              <div className="text-8xl font-serif leading-none">{feedback.score}<span className="text-xl text-muted">/100</span></div>
            </div>
            <div className="text-right space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted">Verdict</div>
              <div className={`text-2xl font-serif ${feedback.isBad ? 'text-red-500' : 'text-green-600'}`}>
                {feedback.isBad ? 'Weak Deck' : 'Solid Structure'}
              </div>
            </div>
          </div>
          
          <div className={`p-10 rounded-3xl space-y-6 ${feedback.isBad ? 'bg-red-50 border border-red-100' : 'bg-black/5'}`}>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Deck Analysis</h4>
            <p className="text-xl leading-relaxed text-muted font-serif italic">"{feedback.feedback}"</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Investor Questions</h4>
              <div className="space-y-4">
                {feedback.questions.map((q, i) => (
                  <div key={i} className="p-6 rounded-2xl border border-black/5 text-muted italic text-sm bg-white/50">
                    {q}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-black/5 p-10 rounded-[2.5rem] flex flex-col justify-center gap-6">
              <p className="text-sm text-muted leading-relaxed">
                {feedback.isBad 
                  ? "Your deck lacks clarity or fails to address key investor concerns. You can retry to refine your deck, or continue the journey."
                  : "Your deck is professionally structured and tells a compelling story. You're ready for high-level meetings."}
              </p>
              <div className="flex flex-col gap-3">
                {feedback.isBad && (
                  <button 
                    onClick={onRetry}
                    className="w-full bg-red-500 text-white font-medium py-5 rounded-2xl hover:scale-[1.02] transition-all shadow-xl flex flex-col items-center justify-center gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-5 h-5" /> Retry Stage
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                      Deducts ${(stage.simulationCost || 0).toLocaleString()} from Budget
                    </div>
                  </button>
                )}
                <button 
                  onClick={onNext}
                  className={`w-full ${feedback.isBad ? 'bg-black/10 text-foreground' : 'bg-foreground text-white'} font-medium py-5 rounded-2xl hover:scale-[1.02] transition-all shadow-xl`}
                >
                  {feedback.isBad ? 'Continue Anyway' : 'Continue Journey'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function ResultView({ feedback, onRestart }: { 
  feedback: { score: number, feedback: string, questions: string[], isBad?: boolean }, 
  onRestart: () => void 
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card p-12 space-y-12 text-center max-w-4xl mx-auto"
    >
      <div className="space-y-6">
        <div className="inline-block p-10 rounded-full bg-black/5">
          <div className="text-8xl font-serif">{feedback.score}<span className="text-2xl text-muted">/100</span></div>
        </div>
        <div className="space-y-2">
          <h2 className="text-5xl font-serif tracking-tight">Final Evaluation</h2>
          <div className={`text-2xl font-serif ${feedback.isBad ? 'text-red-500' : 'text-green-600'}`}>
            {feedback.isBad ? 'Investment Declined' : 'Investment Secured'}
          </div>
        </div>
      </div>

      <div className={`p-10 rounded-[3rem] space-y-8 text-left ${feedback.isBad ? 'bg-red-50 border border-red-100' : 'bg-black/5'}`}>
        <div className="space-y-4">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Investor's Final Verdict</h4>
          <p className="text-2xl font-serif italic leading-relaxed text-muted">"{feedback.feedback}"</p>
        </div>

        {feedback.questions.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted">Critical Questions for the Future</h4>
            <div className="grid gap-4">
              {feedback.questions.map((q, i) => (
                <div key={i} className="p-6 rounded-2xl border border-black/5 text-muted italic text-sm bg-white/50">
                  {q}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <button 
        onClick={onRestart}
        className="w-full bg-foreground text-white font-medium py-6 rounded-2xl hover:scale-[1.02] transition-all text-xl shadow-2xl"
      >
        Restart Journey
      </button>
    </motion.div>
  );
}
