/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from "motion/react";
import { Search, Moon, Sun, X, Asterisk, Settings, ArrowRight, ArrowLeft, BookOpen, Play, RotateCcw, Activity, CloudRain, Flame, Globe, Waves, GraduationCap, MessageSquare, Loader2, PenLine, Calendar, Clock, CheckCircle2, Plus, Trash2, TrendingUp, List, Share2, Copy, Twitter, Linkedin, Check, Sparkles, Hash, Wind, ShieldCheck, Heart, Compass, Target } from "lucide-react";
import { useState, useEffect, useCallback, FormEvent, useMemo, ReactNode } from "react";
import { GoogleGenAI } from "@google/genai";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie } from 'recharts';
import { format, parseISO, subDays, isWithinInterval, startOfDay } from 'date-fns';

import { auth, db, googleProvider, handleFirestoreError, OperationType, User } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence } from "firebase/auth";
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, Timestamp, getDoc } from "firebase/firestore";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Phase = "INHALE" | "HOLD_IN" | "EXHALE" | "HOLD_OUT";
type Tool = "Breathe" | "5-4-3-2-1" | "Reframing" | "Activity" | "Worry" | "Compassion";

const PHASES: Record<Phase, { text: string; duration: number; next: Phase }> = {
  INHALE: { text: "INHALE", duration: 4, next: "HOLD_IN" },
  HOLD_IN: { text: "HOLD", duration: 4, next: "EXHALE" },
  EXHALE: { text: "EXHALE", duration: 4, next: "HOLD_OUT" },
  HOLD_OUT: { text: "HOLD", duration: 4, next: "INHALE" },
};

type Tab = "Home" | "Find Support" | "Tools" | "Learn" | "Self-check" | "About" | "Journal" | "Progress";

interface JournalEntry {
  id: string;
  date: string;
  mood: string;
  content: string;
  tags: string[];
}

interface JournalReminder {
  enabled: boolean;
  time: string;
  frequency: "daily" | "weekly";
}

const SerenityTooltip = ({ text, children, position = "top", className = "" }: { text: string; children: ReactNode; position?: "top" | "bottom" | "left" | "right"; className?: string; key?: string | number | null }) => {
  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  const arrowClasses = {
    top: "top-full left-1/2 -translate-x-1/2 border-t-serenity-charcoal",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-serenity-charcoal",
    left: "left-full top-1/2 -translate-y-1/2 border-l-serenity-charcoal",
    right: "right-full top-1/2 -translate-y-1/2 border-r-serenity-charcoal",
  };

  return (
    <div className={`relative group flex items-center justify-center ${className}`}>
      {children}
      <div className={`absolute ${positionClasses[position]} px-3 py-1.5 bg-serenity-charcoal text-white text-[9px] font-bold uppercase tracking-widest rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 whitespace-nowrap z-[120] shadow-2xl scale-95 group-hover:scale-100 hidden sm:block`}>
        {text}
        <div className={`absolute border-4 border-transparent ${arrowClasses[position]}`} />
      </div>
    </div>
  );
};

export default function App() {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("Breathe");
  const [selectedArticle, setSelectedArticle] = useState<number | null>(null);
  const [selfCheckStep, setSelfCheckStep] = useState<number | null>(null);
  const [selfCheckScores, setSelfCheckScores] = useState<number[]>([]);
  const [breathingSessions, setBreathingSessions] = useState<number>(0);
  const [articlesReadCount, setArticlesReadCount] = useState<number>(0);
  const [isBreathing, setIsBreathing] = useState(false);
  const [isAISearchOpen, setIsAISearchOpen] = useState(false);
  const [isProfSearchOpen, setIsProfSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profSearchQuery, setProfSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState("");
  const [profSearchResult, setProfSearchResult] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isProfSearching, setIsProfSearching] = useState(false);
  const [legalView, setLegalView] = useState<"privacy" | "terms" | null>(null);
  const [phase, setPhase] = useState<Phase>("INHALE");
  const [timeLeft, setTimeLeft] = useState(4);
  const [groundingStep, setGroundingStep] = useState(0);
  const [compassionStep, setCompassionStep] = useState(0);

  // CBT Tools State
  const [negativeThought, setNegativeThought] = useState("");
  const [evidenceFor, setEvidenceFor] = useState("");
  const [evidenceAgainst, setEvidenceAgainst] = useState("");
  const [balancedThought, setBalancedThought] = useState("");
  
  const [activities, setActivities] = useState<{ id: string; text: string; completed: boolean }[]>([]);
  const [newActivity, setNewActivity] = useState("");
  
  const [worries, setWorries] = useState<{ id: string; text: string; scheduled: string }[]>([]);
  const [newWorry, setNewWorry] = useState("");
  const [worryTime, setWorryTime] = useState("18:00");

  // Journal State
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalMood, setJournalMood] = useState("Neutral");
  const [journalContent, setJournalContent] = useState("");
  const [journalTags, setJournalTags] = useState("");
  const [journalView, setJournalView] = useState<"entries" | "trends">("entries");
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [reminder, setReminder] = useState<JournalReminder>({
    enabled: false,
    time: "20:00",
    frequency: "daily"
  });
  const [showReminderSettings, setShowReminderSettings] = useState(false);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [trendDateRange, setTrendDateRange] = useState<"7d" | "30d" | "all">("all");
  const [trendTagFilter, setTrendTagFilter] = useState<string>("all");
  const [journalValidationError, setJournalValidationError] = useState<string | null>(null);

  // Auth & Profile States
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isProfileSetupOpen, setIsProfileSetupOpen] = useState(false);
  const [profileBio, setProfileBio] = useState("");
  const [profileGoal, setProfileGoal] = useState("");
  const [profileWellnessFocus, setProfileWellnessFocus] = useState("Stress");
  const [profileCommitment, setProfileCommitment] = useState("15 mins/day");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Article Reading Preferences
  const [articleFontSize, setArticleFontSize] = useState(18); // Refined default 18px for better mobile legibility
  const [articleLineSpacing, setArticleLineSpacing] = useState(1.8); // Default 1.8
  const [showReadingSettings, setShowReadingSettings] = useState(false);
  const [articleSummaries, setArticleSummaries] = useState<Record<number, string>>({});
  const [isSummarizing, setIsSummarizing] = useState(false);

  useEffect(() => {
    const generateSummary = async () => {
      // Logic for selectedArticle has changed to number, so we check for null
      if (selectedArticle === null || articleSummaries[selectedArticle]) return;

      const article = articles.find(a => a.id === selectedArticle);
      if (!article) return;

      setIsSummarizing(true);
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Summarize this article in 3 short, bullet points for a wellness app. The summary should be concise and supportive. \n\nTitle: ${article.title}\nContent: ${article.content}`,
          config: {
            systemInstruction: "You are an empathetic wellness assistant. Provide concise, professional summaries.",
          }
        });

        if (response.text) {
          setArticleSummaries(prev => ({
            ...prev,
            [selectedArticle]: response.text
          }));
        }
      } catch (error) {
        console.error("AI Summarization failed:", error);
      } finally {
        setIsSummarizing(false);
      }
    };

    if (selectedArticle !== null) {
      generateSummary();
    }
  }, [selectedArticle]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Persistent States - Initialize with defaults, then sync with Firestore
  useEffect(() => {
    if (!user || !isAuthReady) {
      if (isAuthReady && !user) {
        setJournalEntries([]); // Clear entries on logout
      }
      return;
    }

    const q = query(
      collection(db, "users", user.uid, "entries"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries: JournalEntry[] = [];
      snapshot.forEach((doc) => {
        entries.push(doc.data() as JournalEntry);
      });
      setJournalEntries(entries);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/entries`);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Sync user profile
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const syncProfile = async () => {
      try {
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) {
          // First time sign-in
          await setDoc(userRef, {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
            createdAt: new Date().toISOString(),
            bio: "",
            goal: "",
            wellnessFocus: "Stress",
            commitment: "15 mins/day"
          });
          setIsProfileSetupOpen(true);
        } else {
          const userData = userDoc.data();
          // If profile is incomplete, prompt for setup
          if (!userData?.bio || !userData?.goal || !userData?.wellnessFocus || !userData?.commitment) {
            setProfileBio(userData?.bio || "");
            setProfileGoal(userData?.goal || "");
            setProfileWellnessFocus(userData?.wellnessFocus || "Stress");
            setProfileCommitment(userData?.commitment || "15 mins/day");
            setIsProfileSetupOpen(true);
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
      }
    };
    syncProfile();
  }, [user]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab("Home");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      // Set persistence based on rememberMe selection
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithPopup(auth, googleProvider);
      setIsLoginModalOpen(false);
    } catch (error) {
      console.error("Login error:", error);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!user) return;
    if (!profileBio.trim() || !profileGoal.trim()) return;
    
    setIsSavingProfile(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        bio: profileBio,
        goal: profileGoal,
        wellnessFocus: profileWellnessFocus,
        commitment: profileCommitment
      });
      setIsProfileSetupOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAddEntry = async () => {
    setJournalValidationError(null);
    if (!journalContent.trim()) {
      setJournalValidationError("Please share what's on your mind.");
      return;
    }
    
    if (journalContent.length < 10) {
      setJournalValidationError("Reflections should be at least 10 characters long.");
      return;
    }

    if (journalContent.length > 2000) {
      setJournalValidationError("Reflections are limited to 2000 characters.");
      return;
    }

    if (!user) {
      setIsLoginModalOpen(true);
      return;
    }

    const tags = journalTags.split(",").map(t => t.trim()).filter(t => t !== "");
    if (tags.length > 5) {
      setJournalValidationError("Please limit to 5 tags.");
      return;
    }

    if (tags.some(t => t.length > 20)) {
      setJournalValidationError("Each tag should be under 20 characters.");
      return;
    }

    const entryId = Date.now().toString();
    const newEntry: JournalEntry = {
      id: entryId,
      date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      mood: journalMood,
      content: journalContent,
      tags: tags,
    };

    try {
      await setDoc(doc(db, "users", user.uid, "entries", entryId), {
        ...newEntry,
        uid: user.uid,
        createdAt: new Date().toISOString()
      });
      setJournalContent("");
      setJournalTags("");
      setJournalMood("Neutral");
      setShowSaveSuccess(true);
      playSound('success');
      setTimeout(() => setShowSaveSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/entries/${entryId}`);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "entries", entryId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/entries/${entryId}`);
    }
  };

  const moods = [
    { name: "Radiant", color: "bg-serenity-gold", hex: "#F59E0B", icon: "✨", value: 5 },
    { name: "Calm", color: "bg-serenity-blue", hex: "#6366F1", icon: "🌊", value: 4 },
    { name: "Neutral", color: "bg-serenity-slate", hex: "#94A3B8", icon: "☁️", value: 3 },
    { name: "Low", color: "bg-serenity-coral", hex: "#F43F5E", icon: "🌧️", value: 2 },
    { name: "Anxious", color: "bg-serenity-violet", hex: "#8B5CF6", icon: "🌪️", value: 1 },
  ];

  const [soundEnabled, setSoundEnabled] = useState(false);

  const playSound = useCallback((type: 'inhale' | 'exhale' | 'hold' | 'success') => {
    if (!soundEnabled) return;
    
    const sounds = {
      inhale: 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3',
      exhale: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
      hold: 'https://assets.mixkit.co/active_storage/sfx/2570/2570-preview.mp3',
      success: 'https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3'
    };

    const audio = new Audio(sounds[type]);
    audio.volume = 0.15;
    audio.play().catch(() => {});
  }, [soundEnabled]);

  const filteredEntries = useMemo(() => {
    let entries = [...journalEntries];
    
    // Date filter
    if (trendDateRange !== "all") {
      const days = trendDateRange === "7d" ? 7 : 30;
      const cutoff = subDays(new Date(), days);
      entries = entries.filter(entry => new Date(parseInt(entry.id)) >= cutoff);
    }
    
    // Tag filter
    if (trendTagFilter !== "all") {
      entries = entries.filter(entry => entry.tags.includes(trendTagFilter));
    }
    
    return entries;
  }, [journalEntries, trendDateRange, trendTagFilter]);

  const trendData = useMemo(() => {
    return [...filteredEntries]
      .reverse()
      .map(entry => ({
        date: format(new Date(parseInt(entry.id)), 'MMM d'),
        value: moods.find(m => m.name === entry.mood)?.value || 3,
        mood: entry.mood
      }));
  }, [filteredEntries]);

  const tagData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredEntries.forEach(entry => {
      entry.tags.forEach(tag => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filteredEntries]);

  const tagCorrelations = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    filteredEntries.forEach(entry => {
      const moodValue = moods.find(m => m.name === entry.mood)?.value || 3;
      entry.tags.forEach(tag => {
        if (!map[tag]) map[tag] = { total: 0, count: 0 };
        map[tag].total += moodValue;
        map[tag].count += 1;
      });
    });
    return Object.entries(map)
      .map(([tag, data]) => ({
        tag: `#${tag}`,
        avgMood: parseFloat((data.total / data.count).toFixed(2)),
        count: data.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [filteredEntries]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    journalEntries.forEach(entry => entry.tags.forEach(tag => tags.add(tag)));
    return Array.from(tags).sort();
  }, [journalEntries]);

  const mostFrequentMood = useMemo(() => {
    if (filteredEntries.length === 0) return null;
    const counts: Record<string, number> = {};
    filteredEntries.forEach(e => {
      counts[e.mood] = (counts[e.mood] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }, [filteredEntries]);

  const groundingSteps = [
    { title: "5 things you can SEE", desc: "Look around and name 5 things you can see right now." },
    { title: "4 things you can TOUCH", desc: "Notice the texture of your clothes, the chair, or your skin." },
    { title: "3 things you can HEAR", desc: "Listen for distant sounds or the hum of a machine." },
    { title: "2 things you can SMELL", desc: "Try to notice any subtle scents in the air." },
    { title: "1 thing you can TASTE", desc: "Focus on the taste in your mouth or take a sip of water." },
  ];

  const compassionSteps = [
    { title: "Mindfulness", desc: "Acknowledge your current pain or difficulty. Say to yourself, 'This is a moment of suffering' or 'This is really hard right now.'", icon: <CloudRain size={32} /> },
    { title: "Common Humanity", desc: "Recognize that suffering is a part of life and you are not alone. Say, 'Other people feel this way too' or 'Difficulty is part of being human.'", icon: <Globe size={32} /> },
    { title: "Self-Kindness", desc: "Offer yourself warmth. Ask, 'How can I comfort myself right now?' or 'What would I say to a dear friend in this situation?'", icon: <Heart size={32} /> },
  ];

  const articles = [
    {
      id: 1,
      title: "Understanding Anxiety",
      category: "Mental Health",
      icon: <Activity className="text-serenity-blue" />,
      image: "https://picsum.photos/seed/anxiety-calm/800/600",
      excerpt: "Anxiety is more than just feeling stressed. Learn about the symptoms, types, and evidence-based management.",
      content: "Anxiety disorders are the most common mental health concern globally, affecting millions of people across all walks of life. According to the World Health Organization, approximately 1 in every 13 people globally suffers from some form of anxiety. It is characterized by feelings of tension, worried thoughts, and physical changes like increased blood pressure and a rapid heartbeat.\n\nAt its core, anxiety is the body's natural response to stress—a survival mechanism known as the 'fight or flight' response. This system evolved to protect us from immediate physical danger by flooding the body with adrenaline and cortisol. However, in the modern world, this response can become chronic or disproportionate to the actual threat, leading to persistent distress that interferes with daily functioning. Physical symptoms often include a racing heart, rapid breathing, sweating, trembling, and a sense of impending doom. Common types include Generalized Anxiety Disorder, Panic Disorder, Social Anxiety Disorder, and specific phobias.\n\nWhat to do:\n\n1. Acknowledge your feelings without judgment. Simply labeling the emotion as 'anxiety' can help reduce its intensity and give you a sense of control.\n\n2. Practice controlled breathing exercises. Try the 4-7-8 technique: inhale for 4 seconds, hold for 7, and exhale slowly for 8 seconds. This helps reset your nervous system.\n\n3. Limit exposure to known triggers. During periods of high stress, consider reducing your consumption of news or social media, which can often exacerbate feelings of uncertainty.\n\n4. Establish a predictable routine. Having a set schedule for meals, work, and rest provides a sense of safety and stability for your mind.\n\nHow to cope:\n\n- Use grounding techniques like the 5-4-3-2-1 method. This forces your brain to focus on the present moment by identifying things you can see, touch, hear, smell, and taste.\n\n- Engage in regular physical activity. Exercise is a natural way to burn off excess adrenaline and release endorphins, which improve your mood.\n\n- Keep a thought journal. Writing down your worries can help you identify irrational patterns and gain a more objective perspective on your fears.\n\n- Practice mindfulness meditation. Training your brain to observe your thoughts without reacting to them can significantly reduce the power of anxious cycles over time.\n\nProfessional Advice:\n\nIf your anxiety feels unmanageable, persists for more than two weeks, or significantly interferes with your work, relationships, or daily life, please visit a mental health professional. Cognitive Behavioral Therapy and other evidence-based interventions are highly effective and can provide you with personalized tools for long-term recovery and peace of mind.",
      source: "National Alliance on Mental Illness (NAMI) & WHO"
    },
    {
      id: 2,
      title: "Navigating Depression",
      category: "Mental Health",
      icon: <CloudRain className="text-serenity-blue" />,
      image: "https://picsum.photos/seed/depression-hope/800/600",
      excerpt: "Depression is a complex condition affecting mood and cognition. Discover the signs and clinical paths to recovery.",
      content: "Major Depressive Disorder is a leading cause of disability worldwide and is far more complex than simply 'feeling sad.' It is a persistent state of low mood and aversion to activity that can affect a person's thoughts, behavior, feelings, and sense of well-being. The National Institute of Mental Health notes that depression is caused by a complex interplay of genetic, biological, environmental, and psychological factors.\n\nKey indicators of depression include a persistent sad or 'empty' mood, loss of interest in previously enjoyed hobbies (a condition known as anhedonia), significant changes in appetite or weight, and disrupted sleep patterns. It can also manifest as cognitive difficulties, often described as 'brain fog,' which makes simple decisions feel overwhelming and concentration nearly impossible. Recovery is a journey that often involves neuroplasticity—the brain's remarkable ability to reorganize itself and form new neural connections. This is why consistent, long-term treatment and self-care are vital for healing.\n\nWhat to do:\n\n1. Set small, achievable goals for each day. Even basic tasks like getting out of bed, taking a shower, or making a cup of tea are significant victories when you are struggling.\n\n2. Stay connected with others. Reach out to at least one trusted person each day, even if it is just a short text message to say hello.\n\n3. Maintain a basic routine for sleep and nutrition. Stabilizing your body's internal clock can help regulate your mood and energy levels.\n\n4. Avoid making major life decisions during a depressive episode. Your perspective may be temporarily clouded by the symptoms of the condition.\n\nHow to cope:\n\n- Practice behavioral activation. This involves engaging in small activities you used to enjoy, even if you do not feel like doing them initially. The action often precedes the motivation.\n\n- Challenge negative self-talk. When a self-critical thought arises, ask yourself: 'Is this thought a proven fact, or is it a symptom of my depression?'\n\n- Spend time in nature or sunlight. Exposure to natural light helps regulate your circadian rhythm and can provide a subtle but important boost to your mood.\n\n- Use creative outlets. Drawing, writing, or playing music can help you express and process complex emotions that are difficult to put into words.\n\nProfessional Advice:\n\nDepression is a clinical condition that often requires professional support to overcome. If you feel hopeless, experience significant changes in your physical health, or have any thoughts of self-harm, please visit a professional immediately. Therapy, support groups, and medication can help balance brain chemistry and provide the necessary support to navigate the path to recovery.",
      source: "National Institute of Mental Health (NIMH)"
    },
    {
      id: 3,
      title: "Overcoming Burnout",
      category: "Workplace",
      icon: <Flame className="text-serenity-blue" />,
      image: "https://picsum.photos/seed/burnout-rest/800/600",
      excerpt: "Burnout is now recognized as an occupational phenomenon. Learn to identify the three dimensions of exhaustion.",
      content: "The World Health Organization recently redefined burnout as an 'occupational phenomenon' resulting from chronic workplace stress that has not been successfully managed. It is important to distinguish burnout from general stress. While stress often involves 'too much'—too many pressures and responsibilities—burnout is characterized by 'not enough.' It is a state of feeling empty, devoid of motivation, and beyond caring.\n\nBurnout is defined by three key dimensions: 1) feelings of energy depletion or total exhaustion; 2) increased mental distance from one’s job, often manifesting as cynicism or negativity; and 3) a sense of reduced professional efficacy or accomplishment. Chronic burnout is not just a mental state; it can lead to serious physical health issues, as prolonged high cortisol levels can weaken the immune system and increase the risk of cardiovascular problems.\n\nWhat to do:\n\n1. Identify the primary source of your stress. Is it an unmanageable workload, a lack of control over your tasks, or a mismatch between your personal values and the organization's culture?\n\n2. Set firm boundaries. Define clear 'off' times where you do not check work emails, messages, or think about professional responsibilities.\n\n3. Prioritize physical recovery. Ensure you are getting adequate sleep and nutrition, as physical exhaustion often precedes and significantly exacerbates mental burnout.\n\n4. Communicate your needs. If you feel safe doing so, discuss your concerns with a supervisor or HR representative to explore potential workload adjustments or support systems.\n\nHow to cope:\n\n- Practice radical rest. This means dedicated time where you are not being productive and, crucially, not feeling guilty about it.\n\n- Reconnect with your identity outside of work. Engage in hobbies, volunteer work, or social activities that have nothing to do with your professional life.\n\n- Use mindfulness to stay present. When you are not at work, focus entirely on your current environment to prevent 'work rumination' from stealing your recovery time.\n\n- Seek social support. Talking to colleagues or friends who understand the specific pressures of your industry can provide validation and practical advice.\n\nProfessional Advice:\n\nBurnout can lead to severe physical and mental health complications if left unaddressed for too long. If you feel completely detached from your work, experience chronic physical pain, or find that rest no longer restores your energy, please visit a professional. A counselor can help you develop better boundary-setting skills and explore whether a more significant career or lifestyle change is necessary for your long-term health.",
      source: "World Health Organization (WHO) & Mayo Clinic"
    },
    {
      id: 4,
      title: "OFW Loneliness & Resilience",
      category: "Community",
      icon: <Globe className="text-serenity-blue" />,
      image: "https://picsum.photos/seed/family-connection/800/600",
      excerpt: "Separation from family creates a unique emotional challenge. Explore the psychology of the 'Transnational Family'.",
      content: "Overseas Filipino Workers (OFWs) face a unique psychological challenge known as 'ambiguous loss'—a situation where family members are physically absent but remain psychologically present in every aspect of daily life. This creates a constant emotional tug-of-war that can lead to chronic loneliness, anxiety, and a profound sense of displacement.\n\nThe 'social cost' of migration is often high, affecting both the workers and the families left behind. Resilience in these 'transnational families' is often fostered through what researchers call 'virtual intimacy.' This involves leveraging technology not just for practical logistics, but for shared emotional experiences that bridge the physical distance. However, the pressure to provide financially while missing out on significant life milestones can create a heavy emotional burden that requires specific coping strategies.\n\nWhat to do:\n\n1. Schedule regular 'quality time' video calls. Focus these sessions on emotional connection and sharing stories, rather than just discussing finances or household logistics.\n\n2. Create a 'home away from home.' Decorate your living space with familiar items, photos, and scents that remind you of your roots and your loved ones.\n\n3. Build a local support network. Join community groups, religious organizations, or regional associations in your host country to find people who share your experiences.\n\n4. Maintain a shared digital life. Use shared photo albums or group chats to stay involved in the small, everyday moments of your family's life back home.\n\nHow to cope:\n\n- Practice meaning-making. Remind yourself regularly of the long-term goals and the better future your hard work is providing for your family.\n\n- Engage in 'digital mealtimes.' Set up a video call during dinner so you can share a meal and conversation as if you were in the same room.\n\n- Allow yourself to grieve the distance. It is normal and healthy to feel sad about being away; acknowledging these feelings is the first step toward managing them.\n\n- Stay connected to your culture. Cooking traditional meals or listening to familiar music can provide a strong sense of identity and comfort.\n\nProfessional Advice:\n\nThe unique stresses of being an OFW can lead to severe isolation and depression if not managed carefully. If you feel overwhelmed by loneliness, experience persistent anxiety about your family, or find it increasingly difficult to function in your host country, please visit a professional. Many organizations now offer specialized counseling for migrant workers to help navigate the complexities of transnational family life.",
      source: "Philippine Journal of Psychology & DMW Research"
    },
    {
      id: 5,
      title: "Post-Typhoon Trauma",
      category: "Crisis",
      icon: <Waves className="text-serenity-blue" />,
      image: "https://picsum.photos/seed/storm-recovery/800/600",
      excerpt: "Natural disasters impact mental health long after the storm passes. Learn about Psychological First Aid.",
      content: "The psychological impact of natural disasters like typhoons can be profound and long-lasting, often manifesting as Post-Traumatic Stress Disorder. Symptoms can include hyperarousal, flashbacks, and avoidance of reminders of the event. Understanding the 'disaster cycle' is crucial for recovery. This cycle typically includes a 'heroic phase' of immediate action, followed by a 'honeymoon phase' of community support, and eventually a 'disillusionment phase' where the slow pace of recovery becomes apparent.\n\nPsychological First Aid is the internationally recommended early intervention for disaster survivors. It is not traditional therapy, but rather a humane, supportive response to a fellow human being who is suffering and may need support. The core principles involve ensuring safety, providing comfort, and connecting people to information and services. Recovery is a community-wide process that requires patience, solidarity, and sustained mental health support long after the physical debris has been cleared.\n\nWhat to do:\n\n1. Prioritize your basic physical needs first. Ensuring safety, food, clean water, and shelter is the essential foundation for mental health recovery.\n\n2. Limit your exposure to repetitive media coverage of the disaster. Constant reminders can re-traumatize you and keep your nervous system in a state of high alert.\n\n3. Stay connected with your neighbors and community. Sharing your experiences with others who have gone through the same event can provide a powerful sense of solidarity and healing.\n\n4. Re-establish small, daily routines. Even simple habits can help you regain a sense of control and predictability in an environment that feels chaotic.\n\nHow to cope:\n\n- Practice deep breathing and grounding exercises. These simple tools can help calm your nervous system when you feel overwhelmed or hyper-vigilant.\n\n- Talk about your experience when you feel ready. Do not force yourself to relive the trauma, but do not bottle it up either. Find a trusted listener.\n\n- Practice self-compassion. Understand that your emotional reactions—whether they are anger, sadness, or numbness—are normal responses to an abnormal event.\n\n- Participate in community rebuilding efforts if you feel able. Helping others can often provide a sense of purpose that aids in your own healing process.\n\nProfessional Advice:\n\nTrauma can have significant effects on both the brain and the body. If you experience persistent flashbacks, severe sleep disturbances, or find yourself constantly 'on edge' weeks after the disaster, please visit a professional. Trauma-informed therapy can help you process the experience safely and reduce the long-term psychological impact of the crisis.",
      source: "American Psychological Association (APA) & DOH"
    },
    {
      id: 6,
      title: "Managing Academic Stress",
      category: "Education",
      icon: <GraduationCap className="text-serenity-blue" />,
      image: "https://picsum.photos/seed/study-focus/800/600",
      excerpt: "The pressure of high-stakes testing and future uncertainty. Discover the 'Perfectionism Trap'.",
      content: "Academic stress is a significant concern for students today, often driven by what psychologists call 'maladaptive perfectionism.' This is the tendency to set impossibly high standards and be overly critical of any perceived failure. This mindset often leads to a destructive cycle of procrastination, shame, and increased anxiety. In the digital age, constant comparison on social media further exacerbates these feelings, as students compare their internal struggles with the curated successes of their peers.\n\nMany students also experience 'Imposter Syndrome'—the persistent fear of being exposed as a fraud despite clear evidence of their success. Managing academic pressure effectively involves shifting from a 'fixed mindset' (believing intelligence is static) to a 'growth mindset' (believing abilities can be developed). Cultivating self-compassion—treating yourself with the same kindness and understanding you would offer a struggling friend—is one of the most powerful antidotes to academic shame and burnout.\n\nWhat to do:\n\n1. Break large, intimidating tasks into smaller, manageable steps. Focus only on the next 30 minutes of work rather than the entire semester's goals.\n\n2. Use the Pomodoro Technique. Work for 25 minutes with full focus, then take a mandatory 5-minute break to rest your mind.\n\n3. Prioritize consistent sleep. A sleep-deprived brain is significantly less capable of learning new information or regulating complex emotions.\n\n4. Set realistic expectations for yourself. Perfection is an impossible and unnecessary standard; aim for consistent progress and 'good enough' results.\n\nHow to cope:\n\n- Practice self-compassion. When you make a mistake or fail a test, speak to yourself with the same encouragement you would give to a dear friend.\n\n- Use time-blocking. Ensure your schedule includes dedicated, non-negotiable time for rest, physical activity, and social connection.\n\n- Challenge all-or-nothing thinking. Remind yourself that one poor grade does not define your worth or your entire future.\n\n- Reconnect with your 'why.' Remind yourself of the reasons you chose your field of study to find intrinsic motivation that goes beyond just getting high grades.\n\nProfessional Advice:\n\nAcademic pressure can sometimes mask or even trigger deeper mental health issues. If you feel consistently overwhelmed by anxiety, experience a persistent low mood, or find that your academic performance is suffering despite your best efforts, please visit a professional. Most educational institutions offer counseling services specifically designed to help students manage stress and build lasting resilience.",
      source: "Harvard Health & American Psychological Association (APA)"
    }
  ];

  const moodQuestions = [
    {
      question: "In the past week, how often have you felt calm and relaxed?",
      options: ["At no time", "Some of the time", "Half of the time", "Most of the time", "All of the time"]
    },
    {
      question: "In the past week, how often have you felt active and vigorous?",
      options: ["At no time", "Some of the time", "Half of the time", "Most of the time", "All of the time"]
    },
    {
      question: "In the past week, how often have you woken up feeling fresh and rested?",
      options: ["At no time", "Some of the time", "Half of the time", "Most of the time", "All of the time"]
    },
    {
      question: "In the past week, how often has your daily life been filled with things that interest you?",
      options: ["At no time", "Some of the time", "Half of the time", "Most of the time", "All of the time"]
    },
    {
      question: "In the past week, how often have you felt cheerful and in good spirits?",
      options: ["At no time", "Some of the time", "Half of the time", "Most of the time", "All of the time"]
    }
  ];

  const getMoodResult = () => {
    const total = selfCheckScores.reduce((a, b) => a + b, 0);
    if (total <= 5) return { title: "Low Well-being", desc: "You might be going through a tough time. Consider reaching out to a professional or using our grounding tools.", color: "text-serenity-coral" };
    if (total <= 15) return { title: "Moderate Well-being", desc: "You're doing okay, but there's room for more self-care. Try to prioritize rest and things you enjoy.", color: "text-serenity-blue" };
    return { title: "High Well-being", desc: "You seem to be in a good place! Keep maintaining your healthy habits and supporting others.", color: "text-serenity-mint" };
  };

  const LegalModal = ({ type, onClose }: { type: "privacy" | "terms"; onClose: () => void }) => {
    const content = type === "privacy" ? {
      title: "Privacy Policy",
      sections: [
        {
          title: "Our Commitment",
          text: "At Serenity Hub, we value your privacy and are committed to protecting your personal information. This policy outlines how we handle data within our application."
        },
        {
          title: "Data Collection",
          text: "We do not store personal data on our servers. All self-check responses and tool interactions are processed locally in your browser. We do not track your identity or link your usage to any personal accounts."
        },
        {
          title: "AI Search & External Services",
          text: "When you use our AI Search or Professional Directory, your queries are sent to Google's Gemini API to provide helpful responses. These queries are anonymous and do not contain personally identifiable information unless you explicitly provide it."
        },
        {
          title: "Cookies & Local Storage",
          text: "We use minimal local storage to remember your preferences, such as your current tab or tool selection. These are stored only on your device and are not shared with third parties."
        },
        {
          title: "Contact Us",
          text: "If you have any questions regarding this policy, please reach out to us through the professional directory or support channels."
        }
      ]
    } : {
      title: "Terms of Service",
      sections: [
        {
          title: "Acceptance of Terms",
          text: "By accessing and using Serenity Hub, you agree to be bound by these Terms of Service. If you do not agree, please do not use the application."
        },
        {
          title: "Not a Medical Substitute",
          text: "Serenity Hub is a digital wellness tool designed for informational and educational purposes. It is NOT a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of a qualified health provider."
        },
        {
          title: "Emergency Situations",
          text: "Do not use Serenity Hub in a life-threatening emergency. If you are in immediate danger or experiencing a crisis, please contact your local emergency services or a crisis hotline immediately."
        },
        {
          title: "User Responsibility",
          text: "You are responsible for your use of the application and any decisions made based on the information provided. We strive for accuracy but cannot guarantee the effectiveness of the tools for every individual."
        },
        {
          title: "Limitation of Liability",
          text: "Serenity Hub and its creators are not liable for any direct or indirect damages arising from your use of the application or the information contained within it."
        }
      ]
    };

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-serenity-charcoal/80 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-white w-full max-w-2xl max-h-[85vh] rounded-[40px] border border-serenity-charcoal/5 overflow-hidden flex flex-col shadow-2xl"
        >
          <div className="p-8 sm:p-12 border-b border-serenity-charcoal/5 flex justify-between items-center bg-serenity-cream">
            <div>
              <h2 className="text-3xl sm:text-4xl font-serif text-serenity-charcoal tracking-tight mb-2">{content.title}</h2>
              <p className="text-serenity-charcoal/30 text-[10px] font-bold uppercase tracking-[0.2em]">Serenity Hub Legal Information</p>
            </div>
            <button 
              onClick={onClose}
              className="w-12 h-12 rounded-full bg-serenity-charcoal/5 flex items-center justify-center text-serenity-charcoal hover:bg-serenity-charcoal/10 transition-all"
            >
              <X size={24} />
            </button>
          </div>
          <div className="p-8 sm:p-12 overflow-y-auto custom-scrollbar space-y-10">
            {content.sections.map((section, i) => (
              <div key={i} className="space-y-4">
                <h3 className="text-xl font-serif text-serenity-blue">{section.title}</h3>
                <p className="text-serenity-charcoal/70 leading-relaxed text-base sm:text-lg font-light">{section.text}</p>
              </div>
            ))}
          </div>
          <div className="p-8 sm:p-12 border-t border-serenity-charcoal/5 bg-serenity-cream text-center">
            <button 
              onClick={onClose}
              className="btn-primary px-16 py-4"
            >
              I Understand
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  };

  const handleAISearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResult("");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: searchQuery,
        config: {
          systemInstruction: "You are a supportive mental health assistant for Serenity Hub. Provide empathetic, brief, and helpful responses to mental health queries. IMPORTANT: Do not use any markdown formatting like asterisks (*) or hashtags (#) in your response. Use plain text only. Always include a disclaimer that you are an AI and not a substitute for professional help. If the query is about self-harm or immediate danger, strongly urge the user to contact emergency services or a crisis hotline immediately.",
        },
      });
      const cleanedText = (response.text || "").replace(/[*#]/g, "");
      setSearchResult(cleanedText || "I couldn't find an answer to that. Please try rephrasing or contact a professional.");
    } catch (error) {
      console.error("Search error:", error);
      setSearchResult("Sorry, I encountered an error while searching. Please try again later.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleProfSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!profSearchQuery.trim()) return;

    setIsProfSearching(true);
    setProfSearchResult("");
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Find mental health professionals, clinics, or support groups near: ${profSearchQuery}. Provide a structured list of types of support available in that area and clear steps on how to contact them.`,
        config: {
          systemInstruction: "You are a professional directory assistant for Serenity Hub. Your goal is to help users find mental health resources based on their location. IMPORTANT: Do not use any markdown formatting like asterisks (*) or hashtags (#) in your response. Use plain text only. Provide a list of potential resources, types of therapy available, and clear instructions on how to verify credentials and book an appointment. Always include a disclaimer that you are an AI and the user should verify all information independently. If the location is vague, ask for more details.",
        },
      });
      const cleanedText = (response.text || "").replace(/[*#]/g, "");
      setProfSearchResult(cleanedText || "I couldn't find any specific resources for that location. Try a broader area or check local health directories.");
    } catch (error) {
      console.error("Professional search error:", error);
      setProfSearchResult("An error occurred while searching. Please try again later.");
    } finally {
      setIsProfSearching(false);
    }
  };

  const resetBreathing = useCallback(() => {
    setIsBreathing(false);
    setPhase("INHALE");
    setTimeLeft(4);
  }, []);

  const handleShare = async (entry: JournalEntry, platform?: 'twitter' | 'linkedin' | 'copy') => {
    const text = `My Mood Journal Entry (${entry.date}):\n\nMood: ${entry.mood}\n\n"${entry.content}"\n\n#MoodJournal #MentalHealth`;
    
    if (platform === 'copy') {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedId(entry.id);
        setTimeout(() => setCopiedId(null), 2000);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
      return;
    }

    const encodedText = encodeURIComponent(text);
    let url = '';

    if (platform === 'twitter') {
      url = `https://twitter.com/intent/tweet?text=${encodedText}`;
    } else if (platform === 'linkedin') {
      url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}&summary=${encodedText}`;
    }

    if (url) {
      window.open(url, '_blank');
    } else if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Mood Journal Entry',
          text: text,
          url: window.location.href,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    }
    setActiveShareId(null);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeShareId && !(event.target as Element).closest('.relative')) {
        setActiveShareId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeShareId]);

  useEffect(() => {
    // Bright theme by default
    document.documentElement.classList.remove("dark");

    // Load journal entries
    const savedEntries = localStorage.getItem("serenity_journal");
    if (savedEntries) {
      try {
        setJournalEntries(JSON.parse(savedEntries));
      } catch (e) {
        console.error("Failed to parse journal entries", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("serenity_journal", JSON.stringify(journalEntries));
  }, [journalEntries]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isBreathing && activeTool === "Breathe") {
      // Play initial sound
      if (timeLeft === PHASES[phase].duration) {
        if (phase === "INHALE") playSound('inhale');
        else if (phase === "EXHALE") playSound('exhale');
        else playSound('hold');
      }

      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            const nextPhase = PHASES[phase].next;
            setPhase(nextPhase);
            
            // Play sound for next phase
            if (nextPhase === "INHALE") playSound('inhale');
            else if (nextPhase === "EXHALE") playSound('exhale');
            else playSound('hold');

            return PHASES[nextPhase].duration;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isBreathing, phase, activeTool, playSound, timeLeft]);

  const getCircleScale = () => {
    if (activeTool !== "Breathe") return 1;
    switch (phase) {
      case "INHALE": return 1.2;
      case "HOLD_IN": return 1.2;
      case "EXHALE": return 1;
      case "HOLD_OUT": return 1;
      default: return 1;
    }
  };

  return (
    <div className="min-h-screen selection:bg-serenity-slate/20 font-sans transition-colors duration-300">
      {/* Background Atmosphere */}
      <div className="atmosphere" />

      {/* Emergency Help Bar */}
      <div className="fixed top-0 left-0 right-0 z-[60] bg-serenity-charcoal text-white border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-2.5 sm:py-0 sm:h-10 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-10 text-[9px] sm:text-[10px] font-bold tracking-[0.2em] uppercase">
          <div className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-serenity-coral animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.4)]" />
            <span className="whitespace-nowrap text-white/90">Emergency Assistance</span>
          </div>
          <div className="flex items-center gap-5 sm:gap-8">
            <span className="whitespace-nowrap text-serenity-coral">Call or Text 988</span>
            <div className="flex items-center gap-5 sm:gap-8 opacity-60">
              <button 
                onClick={() => {
                  setActiveTab("Find Support");
                  setSelectedArticle(null);
                  setSelfCheckStep(null);
                }} 
                className="hover:text-white transition-colors whitespace-nowrap"
              >
                Crisis Support
              </button>
              <button 
                onClick={() => {
                  setActiveTab("Find Support");
                  setSelectedArticle(null);
                  setSelfCheckStep(null);
                  setIsProfSearchOpen(true);
                }} 
                className="hover:text-white transition-colors whitespace-nowrap"
              >
                Local Help
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Navigation */}
      <header className="hidden lg:flex fixed top-10 left-0 right-0 z-50 px-8 py-6 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-serenity-charcoal rounded-xl flex items-center justify-center shadow-lg shadow-serenity-charcoal/20">
            <ShieldCheck className="text-white" size={20} />
          </div>
          <div className="flex flex-col -gap-1">
            <span className="font-serif text-2xl text-serenity-charcoal tracking-tight leading-tight">Serenity Hub</span>
            <span className="text-[8px] font-bold text-serenity-blue uppercase tracking-[0.4em]">Sanctuary of Peace</span>
          </div>
        </div>

        <nav className="glass rounded-full px-8 py-3 flex items-center gap-8 shadow-xl shadow-serenity-charcoal/5">
          {(["Home", "Tools", "Journal", "Learn", "Progress", "Find Support", "Self-check", "About"] as Tab[]).map((item) => (
            <button
              key={item}
              onClick={() => {
                setActiveTab(item);
                setSelectedArticle(null);
                setSelfCheckStep(null);
                setSelfCheckScores([]);
              }}
              aria-label={`Navigate to ${item}`}
              className={`text-[10px] font-bold uppercase tracking-[0.2em] transition-all hover:text-serenity-blue ${
                activeTab === item ? "text-serenity-blue" : "text-serenity-charcoal/40"
              }`}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <SerenityTooltip text={soundEnabled ? "Mute Atmosphere" : "Unmute Atmosphere"} position="bottom">
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`w-12 h-12 rounded-full border border-serenity-charcoal/5 flex items-center justify-center transition-all shadow-sm ${soundEnabled ? "bg-serenity-blue text-white" : "bg-white text-serenity-charcoal hover:bg-serenity-charcoal/5"}`}
              aria-label={soundEnabled ? "Disable Sound" : "Enable Sound"}
            >
              {soundEnabled ? <Waves size={20} /> : <CloudRain size={20} className="opacity-40" />}
            </button>
          </SerenityTooltip>

          <SerenityTooltip text="AI Support Assistant" position="bottom">
            <button 
              onClick={() => setIsAISearchOpen(true)}
              className="w-12 h-12 rounded-full bg-white border border-serenity-charcoal/5 flex items-center justify-center text-serenity-charcoal hover:bg-serenity-charcoal/5 transition-all shadow-sm"
              aria-label="Open AI Search"
            >
              <Search size={20} />
            </button>
          </SerenityTooltip>

          {user ? (
            <div className="flex items-center gap-3 bg-serenity-charcoal/5 rounded-full pl-4 pr-1 py-1 border border-serenity-charcoal/5">
              <span className="text-[10px] font-bold text-serenity-charcoal/60 uppercase tracking-widest hidden lg:block">
                {user.displayName}
              </span>
              <SerenityTooltip text="User Options & Logout" position="bottom">
                <button 
                  onClick={handleLogout}
                  className="w-10 h-10 rounded-full overflow-hidden border-2 border-white shadow-sm hover:scale-105 transition-transform"
                  title="Logout"
                >
                  <img src={user.photoURL || ""} alt="Profile" className="w-full h-full object-cover" />
                </button>
              </SerenityTooltip>
            </div>
          ) : (
            <SerenityTooltip text="Sign in to Serenity" position="bottom">
              <button 
                onClick={() => setIsLoginModalOpen(true)}
                className="px-6 py-2.5 rounded-full bg-serenity-charcoal text-white text-[10px] font-bold uppercase tracking-widest hover:bg-serenity-charcoal/90 transition-all shadow-lg shadow-serenity-charcoal/20"
              >
                Login
              </button>
            </SerenityTooltip>
          )}
        </div>
      </header>

      {/* Mobile Header Bar */}
      <header className="lg:hidden fixed top-14 left-0 right-0 z-50 px-3 sm:px-6 py-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 sm:gap-2.5 glass px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl pointer-events-auto max-w-[60%] shadow-lg shadow-serenity-charcoal/5">
          <ShieldCheck className="text-serenity-blue shrink-0" size={16} />
          <div className="flex flex-col -gap-0.5">
            <span className="font-serif text-sm sm:text-base text-serenity-charcoal leading-none truncate">Serenity Hub</span>
            <span className="text-[6px] sm:text-[7px] font-bold text-serenity-blue/60 uppercase tracking-widest">Wellness Sanctuary</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto">
          <SerenityTooltip text="AI Support Assistant" position="bottom">
            <button 
              onClick={() => setIsAISearchOpen(true)}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl glass flex items-center justify-center text-serenity-charcoal"
            >
              <Search size={16} />
            </button>
          </SerenityTooltip>
          {user ? (
            <SerenityTooltip text="User Options & Logout" position="bottom">
              <button 
                onClick={handleLogout}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl overflow-hidden border border-white shadow-sm"
                title="Logout"
              >
                <img src={user.photoURL || ""} alt="Profile" className="w-full h-full object-cover" />
              </button>
            </SerenityTooltip>
          ) : (
            <SerenityTooltip text="Sign In" position="bottom">
              <button 
                onClick={() => setIsLoginModalOpen(true)}
                className="h-9 sm:h-10 px-3 sm:px-4 rounded-2xl bg-serenity-charcoal text-white text-[8px] sm:text-[9px] font-bold uppercase tracking-widest shadow-lg shadow-serenity-charcoal/20"
              >
                Login
              </button>
            </SerenityTooltip>
          )}
        </div>
      </header>

      {/* Mobile Navigation */}
      <nav className="lg:hidden fixed bottom-6 left-2 sm:left-6 right-2 sm:right-6 z-50 glass rounded-[32px] px-3 sm:px-6 py-4 flex items-center justify-between shadow-2xl shadow-serenity-charcoal/10">
        {[
          { name: "Home", icon: <Globe size={20} />, tab: "Home" },
          { name: "Tools", icon: <Play size={20} />, tab: "Tools" },
          { name: "Journal", icon: <PenLine size={20} />, tab: "Journal" },
          { name: "Progress", icon: <TrendingUp size={20} />, tab: "Progress" },
          { name: "Learn", icon: <GraduationCap size={20} />, tab: "Learn" },
          { name: "Check", icon: <Activity size={20} />, tab: "Self-check" },
        ].map((item) => (
          <SerenityTooltip key={item.tab} text={item.name} position="top">
            <button
              onClick={() => {
                setActiveTab(item.tab as Tab);
                setSelectedArticle(null);
                setSelfCheckStep(null);
                setSelfCheckScores([]);
              }}
              className={`flex flex-col items-center gap-1 transition-all ${
                activeTab === item.tab ? "text-serenity-blue" : "text-serenity-charcoal/30"
              }`}
            >
              <div className={`p-2 rounded-xl transition-all ${activeTab === item.tab ? "bg-serenity-blue/10 scale-110" : ""}`}>
                {item.icon}
              </div>
            </button>
          </SerenityTooltip>
        ))}
      </nav>

      {/* AI Search Modal */}
      <AnimatePresence>
        {isAISearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-serenity-charcoal/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="premium-card w-full max-w-2xl overflow-hidden shadow-2xl border-serenity-charcoal/5"
            >
              <div className="p-8 border-b border-serenity-charcoal/5 flex justify-between items-center bg-serenity-cream">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-serenity-blue/10 rounded-2xl flex items-center justify-center">
                    <MessageSquare className="text-serenity-blue" size={24} />
                  </div>
                  <div>
                    <h3 className="text-serenity-charcoal font-serif text-xl">AI Support Search</h3>
                    <p className="text-serenity-charcoal/40 text-[10px] font-bold uppercase tracking-[0.2em]">Powered by Serenity AI</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setIsAISearchOpen(false);
                    setSearchQuery("");
                    setSearchResult("");
                  }}
                  className="w-10 h-10 rounded-full hover:bg-serenity-charcoal/5 flex items-center justify-center text-serenity-charcoal/40 hover:text-serenity-charcoal transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8">
                <form onSubmit={handleAISearch} className="relative mb-8">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Ask anything about mental health..."
                    className="w-full bg-serenity-charcoal/5 border-none rounded-2xl py-5 pl-14 pr-4 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all font-light text-lg outline-none"
                    autoFocus
                  />
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-serenity-charcoal/20" size={20} />
                  <button 
                    type="submit"
                    disabled={isSearching || !searchQuery.trim()}
                    className="btn-primary absolute right-4 top-1/2 -translate-y-1/2 py-2 px-6 text-sm"
                  >
                    {isSearching ? <Loader2 className="animate-spin" size={18} /> : "Ask"}
                  </button>
                </form>

                <div className="min-h-[200px] max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                  {isSearching ? (
                    <div className="flex flex-col items-center justify-center py-16 text-serenity-charcoal/40 gap-6">
                      <Loader2 className="animate-spin text-serenity-blue" size={40} />
                      <p className="text-sm font-medium animate-pulse tracking-widest uppercase">Consulting Serenity AI...</p>
                    </div>
                  ) : searchResult ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-serenity-cream rounded-3xl p-8 border border-serenity-charcoal/5"
                    >
                      <div className="prose max-w-none text-serenity-charcoal/80 leading-relaxed whitespace-pre-wrap font-light text-lg">
                        {searchResult}
                      </div>
                    </motion.div>
                  ) : (
                    <div className="text-center py-16 text-serenity-charcoal/30">
                      <p className="text-base font-light">Try asking: "How to handle a panic attack?" or "What is burnout?"</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-5 bg-serenity-cream text-[10px] text-serenity-charcoal/20 text-center uppercase tracking-[0.3em] font-bold border-t border-serenity-charcoal/5">
                AI can make mistakes. Always consult a professional.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Professional Search Modal */}
      <AnimatePresence>
        {isProfSearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-serenity-charcoal/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-serenity-charcoal/5 w-full max-w-2xl rounded-[40px] overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b border-serenity-charcoal/5 flex justify-between items-center bg-serenity-cream">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-serenity-blue/10 rounded-2xl flex items-center justify-center">
                    <Globe className="text-serenity-blue" size={24} />
                  </div>
                  <div>
                    <h3 className="text-serenity-charcoal font-serif text-xl">Find Nearby Professionals</h3>
                    <p className="text-serenity-charcoal/40 text-[10px] font-bold uppercase tracking-[0.2em]">AI-Powered Directory Search</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setIsProfSearchOpen(false);
                    setProfSearchQuery("");
                    setProfSearchResult("");
                  }}
                  className="w-10 h-10 rounded-full hover:bg-serenity-charcoal/5 flex items-center justify-center text-serenity-charcoal/40 hover:text-serenity-charcoal transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8">
                <form onSubmit={handleProfSearch} className="relative mb-8">
                  <input
                    type="text"
                    value={profSearchQuery}
                    onChange={(e) => setProfSearchQuery(e.target.value)}
                    placeholder="Enter your city, zip code, or neighborhood..."
                    className="w-full bg-serenity-charcoal/5 border-none rounded-2xl py-5 pl-14 pr-4 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all font-light text-lg"
                    autoFocus
                  />
                  <Globe className="absolute left-5 top-1/2 -translate-y-1/2 text-serenity-charcoal/20" size={20} />
                  <button 
                    type="submit"
                    disabled={isProfSearching || !profSearchQuery.trim()}
                    className="absolute right-4 top-1/2 -translate-y-1/2 bg-serenity-blue text-white px-6 py-2 rounded-xl text-sm font-bold disabled:opacity-50 transition-all shadow-lg shadow-serenity-blue/20"
                  >
                    {isProfSearching ? <Loader2 className="animate-spin" size={18} /> : "Search"}
                  </button>
                </form>

                <div className="min-h-[200px] max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                  {isProfSearching ? (
                    <div className="flex flex-col items-center justify-center py-16 text-serenity-charcoal/40 gap-6">
                      <Loader2 className="animate-spin text-serenity-blue" size={40} />
                      <p className="text-sm font-medium animate-pulse tracking-widest uppercase">Searching local directories...</p>
                    </div>
                  ) : profSearchResult ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-serenity-cream rounded-3xl p-8 border border-serenity-charcoal/5"
                    >
                      <div className="prose max-w-none text-serenity-charcoal/80 leading-relaxed whitespace-pre-wrap font-light text-lg">
                        {profSearchResult}
                      </div>
                    </motion.div>
                  ) : (
                    <div className="text-center py-16 text-serenity-charcoal/30">
                      <p className="text-base font-light italic">Enter your location to find therapists, counselors, and mental health clinics nearby.</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-5 bg-serenity-cream text-[10px] text-serenity-charcoal/20 text-center uppercase tracking-[0.3em] font-bold border-t border-serenity-charcoal/5">
                Always verify credentials before booking.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-32 sm:pt-40 lg:pt-48 pb-32 flex flex-col items-center">
        {activeTab === "Home" && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-5xl"
          >
            {/* Hero Section */}
            <div className="text-center mb-16 sm:mb-24">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="inline-block px-4 py-1.5 rounded-full bg-serenity-blue/5 text-serenity-blue text-[10px] font-bold uppercase tracking-[0.4em] mb-6 sm:mb-10"
              >
                {getGreeting()}, {user?.displayName?.split(' ')[0] || "Seeker"}
              </motion.div>
              <h1 className="text-4xl sm:text-7xl md:text-8xl lg:text-[10rem] font-serif text-serenity-charcoal mb-8 tracking-tight leading-[1.1] sm:leading-[0.85]">
                Find Your <br className="hidden sm:block" />
                <span className="text-serenity-blue">Inner Peace.</span>
              </h1>
              <p className="text-serenity-charcoal/60 text-lg sm:text-2xl font-light max-w-2xl mx-auto leading-relaxed mb-10 sm:mb-14 px-4">
                Welcome to your curated sanctuary for emotional resilience. We combine evidence-based psychology with elegant design to help you navigate life's complexities.
              </p>
              
              {user && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.4 }}
                  className="max-w-4xl mx-auto mb-20 px-4"
                >
                  <div className="premium-card p-6 sm:p-10 flex flex-col md:flex-row items-center gap-8 text-left bg-gradient-to-br from-serenity-blue/[0.03] to-serenity-mint/[0.03]">
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center gap-3">
                        <Sparkles className="text-serenity-blue" size={20} />
                        <span className="text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Sanctuary Snapshot</span>
                      </div>
                      <h3 className="text-2xl sm:text-3xl font-serif text-serenity-charcoal">
                        {journalEntries.length > 0 
                          ? `You've captured ${journalEntries.length} reflections.` 
                          : "Your journey starts with a single reflection."}
                      </h3>
                      <p className="text-serenity-charcoal/50 font-light leading-relaxed">
                        {journalEntries.length > 0 
                          ? `You've completed ${breathingSessions} breathing sessions and read ${articlesReadCount} wellness articles. Keep it up!`
                          : "Take a moment to check in with yourself. Tracking your mood and tool usage helps identify patterns and emotional triggers."}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                      <button 
                        onClick={() => setActiveTab("Journal")}
                        className="btn-primary flex-1 md:flex-none py-4 px-8 text-sm"
                      >
                        Log Mood
                      </button>
                      <button 
                        onClick={() => setActiveTab("Progress")}
                        className="btn-secondary flex-1 md:flex-none py-4 px-8 text-sm"
                      >
                        View Progress
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-20 px-4">
                <button 
                  onClick={() => setActiveTab("Tools")}
                  className="btn-primary w-full sm:w-auto flex items-center justify-center gap-3"
                >
                  Explore Toolkit <ArrowRight size={18} />
                </button>
                <button 
                  onClick={() => setActiveTab("Learn")}
                  className="btn-secondary w-full sm:w-auto"
                >
                  Our Philosophy
                </button>
              </div>

              {/* Quick Access Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 max-w-4xl mx-auto px-4">
                {[
                  { id: "Breathe", name: "Quick Calm", icon: <Wind size={20} />, color: "bg-serenity-blue/5 text-serenity-blue" },
                  { id: "5-4-3-2-1", name: "Grounding", icon: <Waves size={20} />, color: "bg-serenity-coral/5 text-serenity-coral" },
                  { id: "Journal", name: "Daily Log", icon: <PenLine size={20} />, color: "bg-serenity-gold/5 text-serenity-gold" },
                  { id: "Learn", name: "Sleep Tips", icon: <Moon size={20} />, color: "bg-serenity-mint/5 text-serenity-mint" }
                ].map((item) => (
                  <SerenityTooltip key={item.id} text={item.id === "Breathe" ? "Box Breathing" : item.id === "5-4-3-2-1" ? "Grounding" : item.id === "Journal" ? "Daily Reflections" : "Wellness Advice"} position="top">
                    <button
                      onClick={() => {
                        if (item.id === "Journal" || item.id === "Learn") {
                          setActiveTab(item.id as Tab);
                        } else {
                          setActiveTab("Tools");
                          setActiveTool(item.id as Tool);
                        }
                      }}
                      className="premium-card p-6 flex flex-col items-center justify-center gap-4 hover:scale-105 transition-all text-center w-full min-w-[120px]"
                    >
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${item.color}`}>
                        {item.icon}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-serenity-charcoal/60">{item.name}</span>
                    </button>
                  </SerenityTooltip>
                ))}
              </div>
            </div>

            {/* Mission Section (Hidden on small mobile to reduce excessive scrolling) */}
            <div className="hidden sm:grid grid-cols-1 md:grid-cols-2 gap-12 sm:gap-20 mb-24 sm:mb-40 items-center">
              <div className="relative aspect-[4/5] rounded-[80px] overflow-hidden shadow-2xl rotate-[-2deg]">
                <img 
                  src="https://picsum.photos/seed/serenity-zen/1000/1250" 
                  alt="Zen Garden" 
                  className="object-cover w-full h-full"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-serenity-blue/5 mix-blend-multiply" />
              </div>
              <div className="space-y-10">
                <div className="text-serenity-gold font-bold uppercase tracking-[0.4em] text-[10px]">Our Philosophy</div>
                <h2 className="text-3xl sm:text-6xl font-serif text-serenity-charcoal leading-[1.2] sm:leading-[1.1]">
                  Bridging ancient wisdom with modern psychology.
                </h2>
                <p className="text-serenity-charcoal/70 text-xl leading-relaxed font-light">
                  We believe that mental well-being should be an immersive, beautiful experience. Serenity Hub provides a curated selection of Cognitive Behavioral Therapy (CBT) tools and grounding techniques to help you reclaim your focus and find peace in the present moment.
                </p>
                <div className="grid grid-cols-2 gap-12 pt-6">
                  <div>
                    <div className="text-4xl font-serif text-serenity-charcoal mb-2">Evidence</div>
                    <div className="text-[10px] text-serenity-charcoal/30 uppercase tracking-widest font-bold">Based Practices</div>
                  </div>
                  <div>
                    <div className="text-4xl font-serif text-serenity-charcoal mb-2">Privacy</div>
                    <div className="text-[10px] text-serenity-charcoal/30 uppercase tracking-widest font-bold">First Design</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tools Preview */}
            <div className="mb-40">
              <div className="text-center mb-20">
                <h2 className="text-4xl sm:text-7xl font-serif text-serenity-charcoal mb-6">The Toolkit</h2>
                <p className="text-serenity-charcoal/30 text-[10px] font-bold uppercase tracking-[0.4em]">Five Pillars of Resilience</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {[
                  { title: "Breathe", desc: "Guided box breathing to regulate your nervous system.", icon: <Waves className="text-serenity-blue" />, tool: "Breathe" },
                  { title: "Grounding", desc: "The 5-4-3-2-1 technique to reconnect with reality.", icon: <Activity className="text-serenity-blue" />, tool: "5-4-3-2-1" },
                  { title: "Reframing", desc: "Challenge and restructure negative thought patterns.", icon: <PenLine className="text-serenity-blue" />, tool: "Reframing" },
                  { title: "Compassion", desc: "A guided 3-step practice to quiet your inner critic.", icon: <Heart className="text-serenity-blue" />, tool: "Compassion" },
                  { title: "Planner", desc: "Behavioral activation to schedule joy and achievement.", icon: <Calendar className="text-serenity-blue" />, tool: "Activity" },
                  { title: "Worry Time", desc: "Contain and postpone anxieties to reclaim your day.", icon: <Clock className="text-serenity-blue" />, tool: "Worry" },
                ].map((item) => (
                  <button
                    key={item.title}
                    onClick={() => {
                      setActiveTab("Tools");
                      setActiveTool(item.tool as Tool);
                    }}
                    className="premium-card p-8 sm:p-12 text-center sm:text-left group"
                  >
                    <div className="w-16 h-16 bg-serenity-blue/5 rounded-2xl flex items-center justify-center mb-10 mx-auto sm:mx-0 group-hover:bg-serenity-blue/10 transition-colors">
                      {item.icon}
                    </div>
                    <h3 className="text-2xl sm:text-3xl font-serif text-serenity-charcoal mb-4">{item.title}</h3>
                    <p className="text-serenity-charcoal/60 text-sm sm:text-base leading-relaxed font-light">{item.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "Tools" && (
          <>
            {/* Tool Selector */}
            <div className="flex flex-wrap justify-center gap-2 mb-8 sm:mb-12 bg-serenity-charcoal/5 p-1.5 rounded-2xl sm:rounded-full w-full max-w-5xl mx-auto">
              {(["Breathe", "5-4-3-2-1", "Reframing", "Compassion", "Activity", "Worry"] as Tool[]).map((tool) => (
                <SerenityTooltip 
                  key={tool} 
                  text={
                    tool === "Breathe" ? "Regulate Nervous System" : 
                    tool === "5-4-3-2-1" ? "Sensory Grounding" : 
                    tool === "Reframing" ? "Challenge Thoughts" : 
                    tool === "Compassion" ? "Quiet Inner Critic" : 
                    tool === "Activity" ? "Behavioral Activation" : "Anxiety Containment"
                  }
                >
                  <button
                    onClick={() => {
                      setActiveTool(tool);
                      resetBreathing();
                      setGroundingStep(0);
                      setCompassionStep(0);
                    }}
                    aria-label={`Switch to ${tool} tool`}
                    className={`flex-1 sm:flex-none px-4 sm:px-6 py-2.5 rounded-xl sm:rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-all ${
                      activeTool === tool 
                        ? "bg-serenity-blue text-white shadow-lg shadow-serenity-blue/20" 
                        : "text-serenity-charcoal/40 hover:text-serenity-charcoal hover:bg-serenity-charcoal/5"
                    }`}
                  >
                    {tool === "Breathe" && "Breathe"}
                    {tool === "5-4-3-2-1" && "Grounding"}
                    {tool === "Reframing" && "Reframing"}
                    {tool === "Compassion" && "Compassion"}
                    {tool === "Activity" && "Planner"}
                    {tool === "Worry" && "Worry Time"}
                  </button>
                </SerenityTooltip>
              ))}
            </div>

            {activeTool === "Breathe" && (
              <>
                {/* Breathe Tool Title */}
                <div className="text-center mb-8 px-4">
                  <h1 className="text-4xl sm:text-7xl font-serif text-serenity-charcoal mb-4 tracking-tight leading-tight">
                    The Breathe Tool
                  </h1>
                  <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-lg mx-auto uppercase tracking-[0.4em]">
                    Box Breathing: 4s In • 4s Hold • 4s Out • 4s Hold
                  </p>
                </div>

                {/* Breathing Circle */}
                <div className="relative w-full max-w-[200px] sm:max-w-md aspect-square mb-12 flex items-center justify-center mx-auto">
                  {/* Outer Glow/Shadow */}
                  <motion.div 
                    animate={{ scale: getCircleScale() }}
                    transition={{ duration: 4, ease: "easeInOut" }}
                    className="absolute inset-0 rounded-full bg-serenity-blue/5 blur-[80px] sm:blur-[100px]" 
                  />
                  
                  {/* Main Circle */}
                  <motion.div 
                    animate={{ scale: getCircleScale() }}
                    transition={{ duration: 4, ease: "easeInOut" }}
                    className="relative w-full h-full rounded-full bg-white shadow-[0_40px_100px_-20px_rgba(0,0,0,0.1)] border border-serenity-charcoal/5 flex flex-col items-center justify-center overflow-hidden"
                  >
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={phase}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="text-serenity-charcoal text-3xl sm:text-6xl font-serif tracking-tight"
                      >
                        {PHASES[phase].text}
                      </motion.div>
                    </AnimatePresence>
                    
                    <div className="text-serenity-blue text-lg sm:text-2xl font-bold mt-4 tracking-[0.2em]">
                      {timeLeft}S
                    </div>

                    {/* Progress Dot */}
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-0 pointer-events-none"
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 bg-serenity-blue/10 rounded-full border border-serenity-blue/30 shadow-sm translate-x-1/2" />
                    </motion.div>
                  </motion.div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-row justify-center gap-4 sm:gap-6 mb-12 px-4 w-full max-w-md mx-auto">
                  <SerenityTooltip text={isBreathing ? "Pause Session" : "Begin Session"} className="flex-1">
                    <button 
                      onClick={() => {
                        if (!isBreathing) setBreathingSessions(s => s + 1);
                        setIsBreathing(!isBreathing);
                      }}
                      aria-label={isBreathing ? "Stop breathing session" : "Start breathing session"}
                      className="btn-primary w-full py-4 sm:py-5 text-sm sm:text-lg whitespace-nowrap"
                    >
                      {isBreathing ? <X size={18} /> : <Play size={18} />}
                      {isBreathing ? "Stop" : "Start"}
                    </button>
                  </SerenityTooltip>
                  <SerenityTooltip text="Restart Timer" className="flex-1">
                    <button 
                      onClick={resetBreathing}
                      aria-label="Reset breathing session"
                      className="btn-secondary w-full py-4 sm:py-5 text-sm sm:text-lg"
                    >
                      <RotateCcw size={18} />
                      Reset
                    </button>
                  </SerenityTooltip>
                </div>

                {/* Progress Bars */}
                <div className="flex gap-3 w-full max-w-[260px] sm:max-w-sm mb-32 mx-auto">
                  {Object.keys(PHASES).map((p, i) => (
                    <div 
                      key={p}
                      className={`h-1 flex-1 rounded-full transition-all duration-700 ${
                        phase === p ? "bg-serenity-blue" : "bg-serenity-charcoal/5"
                      }`} 
                    />
                  ))}
                </div>

                {/* Info Section for Breathe */}
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32">
                  <div className="space-y-10">
                    <div>
                      <span className="text-serenity-blue text-[10px] font-bold uppercase tracking-[0.4em] mb-6 block">
                        Why Box Breathing?
                      </span>
                      <h2 className="text-4xl sm:text-5xl font-serif text-serenity-charcoal mb-8 tracking-tight leading-tight">
                        Calm your nervous system in minutes.
                      </h2>
                      <p className="text-serenity-charcoal/60 text-lg sm:text-xl leading-relaxed font-light">
                        Box breathing, also known as square breathing, is a technique used by professionals in high-stress environments to regain focus and reduce anxiety. By regulating your breath, you signal to your brain that you are safe.
                      </p>
                    </div>

                    <div className="space-y-8">
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Settings size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Mental Clarity</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Lowers cortisol and helps clear "brain fog" during panic.</p>
                        </div>
                      </div>
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Moon size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Physical Relief</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Reduces heart rate and muscle tension instantly.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative rounded-[80px] overflow-hidden shadow-2xl group">
                    <img
                      src="https://picsum.photos/seed/forest-breath/1200/800"
                      alt="Forest landscape"
                      className="w-full aspect-[4/3] object-cover transition-transform duration-1000 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-serenity-blue/10 mix-blend-multiply" />
                  </div>
                </div>
              </>
            )}

            {activeTool === "5-4-3-2-1" && (
              <div className="w-full max-w-4xl text-center px-4">
                <h1 className="text-5xl sm:text-7xl font-serif text-serenity-charcoal mb-6 tracking-tight leading-tight">
                  Grounding
                </h1>
                <p className="text-serenity-charcoal/30 text-[10px] font-bold mb-16 max-w-lg mx-auto uppercase tracking-[0.4em]">
                  Reconnect with the present moment.
                </p>

                <div className="premium-card p-10 sm:p-20 min-h-[400px] flex flex-col items-center justify-center relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-2 bg-serenity-charcoal/5">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${((groundingStep + 1) / groundingSteps.length) * 100}%` }}
                      className="h-full bg-serenity-blue"
                    />
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={groundingStep}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.05 }}
                      className="space-y-8"
                    >
                      <h3 className="text-4xl sm:text-6xl font-serif text-serenity-blue">
                        {groundingSteps[groundingStep].title}
                      </h3>
                      <p className="text-2xl sm:text-3xl text-serenity-charcoal/70 leading-relaxed max-w-xl mx-auto font-light">
                        {groundingSteps[groundingStep].desc}
                      </p>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center mt-16 w-full gap-10">
                  <SerenityTooltip text="Previous Sense" className="w-full sm:w-auto">
                    <button 
                      disabled={groundingStep === 0}
                      onClick={() => setGroundingStep(s => s - 1)}
                      className="btn-secondary w-full sm:w-auto px-12 disabled:opacity-30"
                    >
                      Previous
                    </button>
                  </SerenityTooltip>
                  <div className="flex gap-4 order-first sm:order-none">
                    {groundingSteps.map((_, i) => (
                      <div 
                        key={i}
                        className={`w-2 h-2 rounded-full transition-all duration-700 ${i === groundingStep ? "bg-serenity-blue w-10" : "bg-serenity-charcoal/10"}`}
                      />
                    ))}
                  </div>
                  <SerenityTooltip text={groundingStep === groundingSteps.length - 1 ? "Restart Cycle" : "Next Sense"} className="w-full sm:w-auto">
                    <button 
                      onClick={() => {
                        if (groundingStep < groundingSteps.length - 1) {
                          setGroundingStep(s => s + 1);
                        } else {
                          setGroundingStep(0);
                        }
                      }}
                      className="btn-primary w-full sm:w-auto px-16"
                    >
                      {groundingStep === groundingSteps.length - 1 ? "Start Over" : "Next Step"}
                    </button>
                  </SerenityTooltip>
                </div>

                {/* Info Section for 5-4-3-2-1 */}
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32 mt-32">
                  <div className="space-y-10 text-left">
                    <div>
                      <span className="text-serenity-blue text-[10px] font-bold uppercase tracking-[0.4em] mb-6 block">
                        Why Grounding?
                      </span>
                      <h2 className="text-4xl sm:text-5xl font-serif text-serenity-charcoal mb-8 tracking-tight leading-tight">
                        Reconnect with the present moment.
                      </h2>
                      <p className="text-serenity-charcoal/60 text-lg sm:text-xl leading-relaxed font-light">
                        The 5-4-3-2-1 technique is a grounding exercise that helps you focus on your surroundings and pull your mind away from anxious thoughts. By engaging all five senses, you interrupt the cycle of anxiety and bring yourself back to the "here and now."
                      </p>
                    </div>

                    <div className="space-y-8">
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Activity size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Sensory Awareness</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Helps you step out of your head and into your body through sensory input.</p>
                        </div>
                      </div>
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Settings size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Immediate Focus</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Provides a structured way to manage overwhelming emotions and panic.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative rounded-[80px] overflow-hidden shadow-2xl group">
                    <img
                      src="https://picsum.photos/seed/meditation-ground/1200/800"
                      alt="Person meditating"
                      className="w-full aspect-[4/3] object-cover transition-transform duration-1000 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-serenity-blue/10 mix-blend-multiply" />
                  </div>
                </div>
              </div>
            )}

            {activeTool === "Compassion" && (
              <div className="w-full max-w-4xl text-center px-4">
                <h1 className="text-5xl sm:text-7xl font-serif text-serenity-charcoal mb-6 tracking-tight leading-tight">
                  Self-Compassion
                </h1>
                <p className="text-serenity-charcoal/30 text-[10px] font-bold mb-16 max-w-lg mx-auto uppercase tracking-[0.4em]">
                  A 3-step break for the soul.
                </p>

                <div className="premium-card p-10 sm:p-20 min-h-[450px] flex flex-col items-center justify-center relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-2 bg-serenity-charcoal/5">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${((compassionStep + 1) / compassionSteps.length) * 100}%` }}
                      className="h-full bg-serenity-blue"
                    />
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={compassionStep}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-10"
                    >
                      <div className="w-20 h-20 bg-serenity-blue/5 rounded-3xl flex items-center justify-center text-serenity-blue mx-auto mb-8">
                        {compassionSteps[compassionStep].icon}
                      </div>
                      <h3 className="text-4xl sm:text-5xl font-serif text-serenity-charcoal">
                        {compassionSteps[compassionStep].title}
                      </h3>
                      <p className="text-xl sm:text-2xl text-serenity-charcoal/60 leading-relaxed max-w-xl mx-auto font-light">
                        {compassionSteps[compassionStep].desc}
                      </p>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="flex flex-col sm:flex-row justify-between items-center mt-16 w-full gap-10">
                  <SerenityTooltip text="Previous Stage" className="w-full sm:w-auto">
                    <button 
                      disabled={compassionStep === 0}
                      onClick={() => setCompassionStep(s => s - 1)}
                      className="btn-secondary w-full sm:w-auto px-12 disabled:opacity-30"
                    >
                      Previous
                    </button>
                  </SerenityTooltip>
                  <div className="flex gap-4 order-first sm:order-none">
                    {compassionSteps.map((_, i) => (
                      <div 
                        key={i}
                        className={`w-2.5 h-2.5 rounded-full transition-all duration-700 ${i === compassionStep ? "bg-serenity-blue w-12" : "bg-serenity-charcoal/10"}`}
                      />
                    ))}
                  </div>
                  <SerenityTooltip text={compassionStep === compassionSteps.length - 1 ? "End Practice" : "Next Stage"} className="w-full sm:w-auto">
                    <button 
                      onClick={() => {
                        if (compassionStep < compassionSteps.length - 1) {
                          setCompassionStep(s => s + 1);
                        } else {
                          setCompassionStep(0);
                          setActiveTab("Home");
                        }
                      }}
                      className="btn-primary w-full sm:w-auto px-16"
                    >
                      {compassionStep === compassionSteps.length - 1 ? "Finish" : "Continue"}
                    </button>
                  </SerenityTooltip>
                </div>

                {/* Info Section for Compassion */}
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32 mt-32">
                  <div className="space-y-10 text-left">
                    <div>
                      <span className="text-serenity-blue text-[10px] font-bold uppercase tracking-[0.4em] mb-6 block">
                        Why Self-Compassion?
                      </span>
                      <h2 className="text-4xl sm:text-5xl font-serif text-serenity-charcoal mb-8 tracking-tight leading-tight">
                        Treat yourself with the same kindness you'd give a friend.
                      </h2>
                      <p className="text-serenity-charcoal/60 text-lg sm:text-xl leading-relaxed font-light">
                        Self-compassion is a practice developed by Dr. Kristin Neff that involves responding to your own suffering with kindness rather than self-judgment. It consists of three core components: mindfulness, common humanity, and self-kindness.
                      </p>
                    </div>

                    <div className="space-y-8">
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <ShieldCheck size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Relilience Building</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Reduces the impact of setbacks and failure on your emotional well-being.</p>
                        </div>
                      </div>
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Activity size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Reduced Anxiety</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Quiets the inner critic and lowers physiological stress markers in the body.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative rounded-[80px] overflow-hidden shadow-2xl group">
                    <img
                      src="https://picsum.photos/seed/gentle-bloom/1200/800"
                      alt="Soft flower blooming"
                      className="w-full aspect-[4/3] object-cover transition-transform duration-1000 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-serenity-blue/5 mix-blend-multiply" />
                  </div>
                </div>
              </div>
            )}

            {activeTool === "Reframing" && (
              <div className="w-full max-w-3xl px-4">
                <div className="text-center mb-16">
                  <h1 className="text-5xl sm:text-7xl font-serif text-serenity-charcoal mb-6 tracking-tight leading-tight">
                    Reframing
                  </h1>
                  <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-lg mx-auto uppercase tracking-[0.4em]">
                    Challenge and transform negative thoughts.
                  </p>
                </div>

                <div className="space-y-8">
                  <div className="premium-card p-10">
                    <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em] mb-6">The Negative Thought</label>
                    <textarea 
                      value={negativeThought}
                      onChange={(e) => setNegativeThought(e.target.value)}
                      placeholder="What is the thought that's bothering you?"
                      className="w-full bg-serenity-cream border-none rounded-3xl p-6 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all min-h-[120px] resize-none font-light text-lg"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="premium-card p-10">
                      <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em] mb-6">Evidence For</label>
                      <textarea 
                        value={evidenceFor}
                        onChange={(e) => setEvidenceFor(e.target.value)}
                        placeholder="What facts support this thought?"
                        className="w-full bg-serenity-cream border-none rounded-3xl p-6 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all min-h-[140px] resize-none font-light text-lg"
                      />
                    </div>
                    <div className="premium-card p-10">
                      <label className="block text-[10px] font-bold text-serenity-coral uppercase tracking-[0.3em] mb-6">Evidence Against</label>
                      <textarea 
                        value={evidenceAgainst}
                        onChange={(e) => setEvidenceAgainst(e.target.value)}
                        placeholder="What facts contradict this thought?"
                        className="w-full bg-serenity-cream border-none rounded-3xl p-6 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all min-h-[140px] resize-none font-light text-lg"
                      />
                    </div>
                  </div>

                  <div className="premium-card p-10 bg-serenity-blue/5 border-serenity-blue/10">
                    <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em] mb-6">Balanced Perspective</label>
                    <textarea 
                      value={balancedThought}
                      onChange={(e) => setBalancedThought(e.target.value)}
                      placeholder="Based on the evidence, what's a more balanced way to see this?"
                      className="w-full bg-white border-none rounded-3xl p-6 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all min-h-[120px] resize-none font-light text-lg"
                    />
                  </div>

                  <div className="flex justify-center pt-8">
                    <SerenityTooltip text="Clear Perspective Exercise">
                      <button 
                        onClick={() => {
                          setNegativeThought("");
                          setEvidenceFor("");
                          setEvidenceAgainst("");
                          setBalancedThought("");
                        }}
                        className="btn-secondary"
                      >
                        Clear Exercise
                      </button>
                    </SerenityTooltip>
                  </div>
                </div>

                {/* Info Section for Reframing */}
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32 mt-32">
                  <div className="space-y-10 text-left">
                    <div>
                      <span className="text-serenity-blue text-[10px] font-bold uppercase tracking-[0.4em] mb-6 block">
                        Why Reframing?
                      </span>
                      <h2 className="text-4xl sm:text-5xl font-serif text-serenity-charcoal mb-8 tracking-tight leading-tight">
                        Break the cycle of negative thinking.
                      </h2>
                      <p className="text-serenity-charcoal/60 text-lg sm:text-xl leading-relaxed font-light">
                        Cognitive reframing is a psychological technique that helps you identify and then dispute irrational or maladaptive thoughts. By looking at a situation from a different perspective, you can change the emotional impact it has on you.
                      </p>
                    </div>

                    <div className="space-y-8">
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <BookOpen size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Balanced Thinking</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Moves you away from "all-or-nothing" thinking toward a more realistic view.</p>
                        </div>
                      </div>
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <ShieldCheck size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Emotional Control</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Reduces the intensity of difficult emotions by addressing their root thoughts.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative rounded-[80px] overflow-hidden shadow-2xl group">
                    <img
                      src="https://picsum.photos/seed/viewpoint/1200/800"
                      alt="Scenic mountain view"
                      className="w-full aspect-[4/3] object-cover transition-transform duration-1000 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-serenity-blue/5 mix-blend-multiply" />
                  </div>
                </div>
              </div>
            )}

            {activeTool === "Activity" && (
              <div className="w-full max-w-3xl px-4">
                <div className="text-center mb-16">
                  <h1 className="text-5xl sm:text-7xl font-serif text-serenity-charcoal mb-6 tracking-tight leading-tight">
                    Planner
                  </h1>
                  <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-lg mx-auto uppercase tracking-[0.4em]">
                    Behavioral Activation: Schedule joy and achievement.
                  </p>
                </div>

                <div className="premium-card p-8 sm:p-12">
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newActivity.trim()) return;
                      setActivities([...activities, { id: Date.now().toString(), text: newActivity, completed: false }]);
                      setNewActivity("");
                    }}
                    className="flex gap-4 mb-10"
                  >
                    <input 
                      type="text"
                      value={newActivity}
                      onChange={(e) => setNewActivity(e.target.value)}
                      placeholder="Add a small, positive activity..."
                      className="flex-1 bg-serenity-cream border-none rounded-2xl px-8 py-5 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all font-light text-lg"
                    />
                    <SerenityTooltip text="Add to Schedule">
                      <button 
                        type="submit"
                        className="w-16 h-16 bg-serenity-blue text-white rounded-2xl flex items-center justify-center hover:scale-105 transition-all active:scale-95 shadow-lg shadow-serenity-blue/20"
                      >
                        <Plus size={28} />
                      </button>
                    </SerenityTooltip>
                  </form>

                  <div className="space-y-5">
                    <AnimatePresence initial={false}>
                      {activities.length === 0 ? (
                        <div className="text-center py-16 text-serenity-charcoal/20 font-serif text-2xl">
                          No activities planned yet. Start small.
                        </div>
                      ) : (
                        activities.map((activity) => (
                          <motion.div 
                            key={activity.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="flex items-center gap-6 bg-serenity-cream p-6 rounded-3xl border border-transparent group hover:border-serenity-blue/20 transition-all"
                          >
                             <SerenityTooltip text={activity.completed ? "Mark Incomplete" : "Complete Task"}>
                               <button 
                                 onClick={() => setActivities(activities.map(a => a.id === activity.id ? { ...a, completed: !a.completed } : a))}
                                 className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${activity.completed ? "bg-serenity-sage border-serenity-sage" : "border-serenity-charcoal/10 group-hover:border-serenity-charcoal/30"}`}
                               >
                                 {activity.completed && <CheckCircle2 size={18} className="text-white" />}
                               </button>
                             </SerenityTooltip>
                             <span className={`flex-1 text-serenity-charcoal transition-all font-light text-lg ${activity.completed ? "opacity-30 line-through" : "opacity-90"}`}>
                               {activity.text}
                             </span>
                             <SerenityTooltip text="Dismiss Activity">
                               <button 
                                 onClick={() => setActivities(activities.filter(a => a.id !== activity.id))}
                                 className="p-2 text-serenity-charcoal/5 hover:text-serenity-coral transition-colors"
                               >
                                 <Trash2 size={20} />
                               </button>
                             </SerenityTooltip>
                           </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Info Section for Activity Planner */}
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32 mt-32">
                  <div className="space-y-10 text-left">
                    <div>
                      <span className="text-serenity-blue text-[10px] font-bold uppercase tracking-[0.4em] mb-6 block">
                        Why Behavioral Activation?
                      </span>
                      <h2 className="text-4xl sm:text-5xl font-serif text-serenity-charcoal mb-8 tracking-tight leading-tight">
                        Action is the antidote to low mood.
                      </h2>
                      <p className="text-serenity-charcoal/60 text-lg sm:text-xl leading-relaxed font-light">
                        Behavioral Activation is a core CBT skill based on the idea that when we feel low, we stop doing things that give us joy or achievement, which makes us feel worse. By scheduling "nourishing" activities, you break the cycle of lethargy.
                      </p>
                    </div>

                    <div className="space-y-8">
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Activity size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Cycle Breaking</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Interrupts the loop of withdrawal and depression by re-introducing rewarding inputs.</p>
                        </div>
                      </div>
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Compass size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Sense of Purpose</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Restores feelings of competence and pleasure through small, achievable goals.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative rounded-[80px] overflow-hidden shadow-2xl group">
                    <img
                      src="https://picsum.photos/seed/active-life/1200/800"
                      alt="Someone walking in nature"
                      className="w-full aspect-[4/3] object-cover transition-transform duration-1000 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-serenity-blue/5 mix-blend-multiply" />
                  </div>
                </div>
              </div>
            )}

            {activeTool === "Worry" && (
              <div className="w-full max-w-4xl px-4">
                <div className="text-center mb-10">
                  <h1 className="text-4xl sm:text-7xl font-serif text-serenity-charcoal mb-4 tracking-tight leading-tight">
                    Worry Time
                  </h1>
                  <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-lg mx-auto uppercase tracking-[0.4em]">
                    Postpone worries to a scheduled time.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-1 space-y-6">
                    <div className="premium-card p-6">
                      <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em] mb-6">Scheduled Time</label>
                      <div className="flex items-center gap-4 bg-serenity-cream rounded-2xl px-6 py-4 border border-transparent">
                        <Clock size={20} className="text-serenity-blue" />
                        <input 
                          type="time"
                          value={worryTime}
                          onChange={(e) => setWorryTime(e.target.value)}
                          className="bg-transparent text-serenity-charcoal focus:outline-none w-full font-bold text-lg"
                        />
                      </div>
                      <p className="text-[10px] text-serenity-charcoal/40 mt-6 leading-relaxed font-medium uppercase tracking-widest">
                        When a worry pops up, capture it and deal with it at {worryTime}.
                      </p>
                    </div>
                  </div>

                  <div className="lg:col-span-2 premium-card p-8 sm:p-12">
                    <form 
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!newWorry.trim()) return;
                        setWorries([...worries, { id: Date.now().toString(), text: newWorry, scheduled: worryTime }]);
                        setNewWorry("");
                      }}
                      className="flex gap-4 mb-10"
                    >
                      <input 
                        type="text"
                        value={newWorry}
                        onChange={(e) => setNewWorry(e.target.value)}
                        placeholder="Capture a worry for later..."
                        className="flex-1 bg-serenity-cream border-none rounded-2xl px-8 py-5 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all font-light text-lg"
                      />
                      <SerenityTooltip text="Capture Worry">
                        <button 
                          type="submit"
                          className="w-16 h-16 bg-serenity-blue text-white rounded-2xl flex items-center justify-center hover:scale-105 transition-all active:scale-95 shadow-lg shadow-serenity-blue/20"
                        >
                          <Plus size={28} />
                        </button>
                      </SerenityTooltip>
                    </form>

                    <div className="space-y-5">
                      <AnimatePresence initial={false}>
                        {worries.length === 0 ? (
                          <div className="text-center py-16 text-serenity-charcoal/20 font-serif text-2xl bg-serenity-cream rounded-[32px]">
                            Your worry container is empty.
                          </div>
                        ) : (
                          worries.map((worry) => (
                            <motion.div 
                              key={worry.id}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              className="flex items-center gap-6 bg-serenity-cream p-6 rounded-3xl border border-transparent group hover:border-serenity-coral/20 transition-all"
                            >
                              <div className="w-2.5 h-2.5 rounded-full bg-serenity-coral/40" />
                              <span className="flex-1 text-serenity-charcoal/90 font-light text-lg">
                                {worry.text}
                              </span>
                              <button 
                                onClick={() => setWorries(worries.filter(w => w.id !== worry.id))}
                                className="p-2 text-serenity-charcoal/5 hover:text-serenity-coral transition-colors"
                              >
                                <Trash2 size={20} />
                              </button>
                            </motion.div>
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Info Section for Worry Time */}
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32 mt-32">
                  <div className="space-y-10 text-left">
                    <div>
                      <span className="text-serenity-blue text-[10px] font-bold uppercase tracking-[0.4em] mb-6 block">
                        Why Managed Worry?
                      </span>
                      <h2 className="text-4xl sm:text-5xl font-serif text-serenity-charcoal mb-8 tracking-tight leading-tight">
                        Reclaim your focus by containing anxiety.
                      </h2>
                      <p className="text-serenity-charcoal/60 text-lg sm:text-xl leading-relaxed font-light">
                        Worry time is a stimulus control technique. Instead of letting worries intrude all day, you "postpone" them to a specific time. This helps you realize that thoughts are not urgent commands and gives you a sense of control over your attention.
                      </p>
                    </div>

                    <div className="space-y-8">
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Clock size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Mindful Postponement</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Trains your brain to choose when to engage with anxious thoughts.</p>
                        </div>
                      </div>
                      <div className="flex gap-6 items-start">
                        <div className="w-14 h-14 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue flex-shrink-0">
                          <Target size={24} />
                        </div>
                        <div>
                          <h4 className="font-serif text-2xl text-serenity-charcoal mb-2">Cognitive Efficiency</h4>
                          <p className="text-base text-serenity-charcoal/40 font-light">Reduces the constant mental drain caused by chronic rumination.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative rounded-[80px] overflow-hidden shadow-2xl group">
                    <img
                      src="https://picsum.photos/seed/peace-clock/1200/800"
                      alt="Calm clock"
                      className="w-full aspect-[4/3] object-cover transition-transform duration-1000 group-hover:scale-110"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-serenity-blue/5 mix-blend-multiply" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "Find Support" && (
          <div className="w-full max-w-6xl px-4">
            <div className="text-center mb-12">
              <h2 className="text-4xl sm:text-7xl font-serif text-serenity-charcoal mb-4 tracking-tight leading-tight">Find Support</h2>
              <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-lg mx-auto uppercase tracking-[0.4em]">
                You are not alone. Help is always available.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="premium-card p-10 sm:p-20">
                <h3 className="text-3xl font-serif mb-10 text-serenity-charcoal">Crisis Hotlines</h3>
                <ul className="space-y-8 text-serenity-charcoal/80">
                  <li className="flex flex-col gap-2">
                    <span className="text-serenity-blue font-bold uppercase tracking-[0.3em] text-[10px]">Suicide & Crisis Lifeline</span>
                    <div className="flex flex-wrap gap-4">
                      <a href="tel:988" className="text-2xl font-light hover:text-serenity-blue transition-colors">Call 988</a>
                      <a href="sms:988" className="text-2xl font-light hover:text-serenity-blue transition-colors">Text 988</a>
                    </div>
                  </li>
                  <li className="flex flex-col gap-2">
                    <span className="text-serenity-blue font-bold uppercase tracking-[0.3em] text-[10px]">Crisis Text Line</span>
                    <a href="sms:741741" className="text-2xl font-light hover:text-serenity-blue transition-colors">Text HOME to 741741</a>
                  </li>
                  <li className="flex flex-col gap-2">
                    <span className="text-serenity-blue font-bold uppercase tracking-[0.3em] text-[10px]">The Trevor Project</span>
                    <a href="tel:18664887386" className="text-2xl font-light hover:text-serenity-blue transition-colors">1-866-488-7386</a>
                  </li>
                </ul>
              </div>
              <div className="premium-card p-10 sm:p-20 flex flex-col justify-between">
                <div>
                  <h3 className="text-3xl font-serif mb-10 text-serenity-charcoal">Professional Help</h3>
                  <p className="text-serenity-charcoal/80 mb-12 text-xl font-light leading-relaxed">
                    Connect with licensed therapists, counselors, and mental health clinics in your immediate area.
                  </p>
                </div>
                <button 
                  onClick={() => setIsProfSearchOpen(true)}
                  aria-label="Search directory for professional help"
                  className="btn-primary w-full py-5 text-lg"
                >
                  Search Directory <ArrowRight size={20} />
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "Learn" && (
          <div className="w-full max-w-6xl px-4">
            <AnimatePresence mode="wait">
              {selectedArticle === null ? (
                <motion.div
                  key="article-list"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <div className="text-center mb-12">
                    <h2 className="text-4xl sm:text-7xl font-serif text-serenity-charcoal mb-4 tracking-tight leading-tight">Learn & Grow</h2>
                    <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-2xl mx-auto leading-relaxed uppercase tracking-[0.4em]">
                      Explore our curated library of articles to better understand mental health.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {articles.map((article, index) => (
                      <motion.div
                        key={article.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        onClick={() => setSelectedArticle(article.id)}
                        className="premium-card group cursor-pointer overflow-hidden flex flex-col h-full"
                      >
                        <div className="relative h-64 overflow-hidden">
                          <img 
                            src={article.image} 
                            alt={article.title}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-serenity-blue/5 group-hover:bg-serenity-blue/0 transition-colors" />
                          <div className="absolute top-6 left-6">
                            <span className="px-4 py-2 bg-white/90 backdrop-blur-sm rounded-full text-[10px] font-bold text-serenity-charcoal uppercase tracking-widest">
                              {article.category}
                            </span>
                          </div>
                        </div>
                        <div className="p-8 flex flex-col flex-1">
                          <h3 className="text-2xl font-serif text-serenity-charcoal mb-4 group-hover:text-serenity-blue transition-colors">
                            {article.title}
                          </h3>
                          <p className="text-serenity-charcoal/60 text-base font-light leading-relaxed mb-8 line-clamp-3">
                            {article.excerpt}
                          </p>
                          <div className="mt-auto flex items-center text-serenity-blue text-[10px] font-bold uppercase tracking-[0.2em] gap-2">
                            Read Article <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="article-detail"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="max-w-4xl mx-auto"
                >
                  <div className="flex items-center justify-between mb-12">
                    <SerenityTooltip text="Return to Library" position="right">
                      <button 
                        onClick={() => setSelectedArticle(null)}
                        className="flex items-center gap-3 text-serenity-charcoal/40 hover:text-serenity-charcoal transition-colors group"
                      >
                        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Back to Library</span>
                      </button>
                    </SerenityTooltip>

                    <div className="relative">
                      <SerenityTooltip text="Reading Customization">
                        <button
                          onClick={() => setShowReadingSettings(!showReadingSettings)}
                          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                            showReadingSettings ? "bg-serenity-blue text-white" : "bg-serenity-charcoal/5 text-serenity-charcoal/40 hover:text-serenity-charcoal"
                          }`}
                        >
                          <Settings size={14} />
                          Reading Settings
                        </button>
                      </SerenityTooltip>

                      <AnimatePresence>
                        {showReadingSettings && (
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute right-0 top-full mt-4 glass p-6 rounded-2xl shadow-2xl z-50 min-w-[280px] border border-serenity-charcoal/5"
                          >
                            <div className="space-y-6">
                              <div>
                                <div className="flex justify-between mb-3">
                                  <label className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Font Size</label>
                                  <span className="text-[10px] font-bold text-serenity-blue">{articleFontSize}px</span>
                                </div>
                                <input 
                                  type="range" 
                                  min="14" 
                                  max="32" 
                                  value={articleFontSize}
                                  onChange={(e) => setArticleFontSize(parseInt(e.target.value))}
                                  className="w-full h-1.5 bg-serenity-charcoal/10 rounded-lg appearance-none cursor-pointer accent-serenity-blue"
                                />
                              </div>
                              <div>
                                <div className="flex justify-between mb-3">
                                  <label className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Line Spacing</label>
                                  <span className="text-[10px] font-bold text-serenity-blue">{articleLineSpacing}x</span>
                                </div>
                                <input 
                                  type="range" 
                                  min="1.2" 
                                  max="2.5" 
                                  step="0.1"
                                  value={articleLineSpacing}
                                  onChange={(e) => setArticleLineSpacing(parseFloat(e.target.value))}
                                  className="w-full h-1.5 bg-serenity-charcoal/10 rounded-lg appearance-none cursor-pointer accent-serenity-blue"
                                />
                              </div>
                              <button 
                                onClick={() => {
                                  setArticleFontSize(18);
                                  setArticleLineSpacing(1.8);
                                }}
                                className="w-full py-2 text-[10px] font-bold text-serenity-blue uppercase tracking-widest hover:bg-serenity-blue/5 rounded-lg transition-colors"
                              >
                                Reset to Default
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {articles.find(a => a.id === selectedArticle) && (
                    <div className="premium-card overflow-hidden mb-20">
                      <div className="relative h-[250px] sm:h-[500px]">
                        <img 
                          src={articles.find(a => a.id === selectedArticle)?.image} 
                          alt={articles.find(a => a.id === selectedArticle)?.title}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-serenity-cream/90 via-serenity-cream/40 to-transparent" />
                        <div className="absolute bottom-6 sm:bottom-12 left-6 sm:left-12 right-6 sm:right-12">
                          <span className="px-3 py-1.5 sm:px-4 sm:py-2 bg-serenity-blue text-white rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mb-4 sm:mb-6 inline-block">
                            {articles.find(a => a.id === selectedArticle)?.category}
                          </span>
                          <h1 className="text-3xl sm:text-6xl font-serif text-serenity-charcoal tracking-tight leading-tight">
                            {articles.find(a => a.id === selectedArticle)?.title}
                          </h1>
                        </div>
                      </div>
                      <div className="p-5 sm:p-20">
                        {selectedArticle !== null && (articleSummaries[selectedArticle] || isSummarizing) && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-12 p-6 sm:p-8 rounded-3xl bg-serenity-blue/[0.03] border border-serenity-blue/10 relative overflow-hidden"
                          >
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                              <Sparkles size={40} className="text-serenity-blue" />
                            </div>
                            <div className="flex items-center gap-3 mb-6">
                              <div className="w-8 h-8 rounded-lg bg-serenity-blue/10 flex items-center justify-center">
                                <Sparkles size={16} className="text-serenity-blue" />
                              </div>
                              <span className="text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Serenity AI Snapshot</span>
                            </div>
                            
                            {isSummarizing ? (
                              <div className="flex items-center gap-4 py-4">
                                <Loader2 className="animate-spin text-serenity-blue" size={20} />
                                <p className="text-xs font-medium text-serenity-charcoal/40 uppercase tracking-widest animate-pulse">Generating Insight...</p>
                              </div>
                            ) : (
                              <div className="text-sm sm:text-base text-serenity-charcoal/70 font-light leading-relaxed prose prose-sm max-w-none">
                                {articleSummaries[selectedArticle].split('\n').map((line, i) => (
                                  <p key={i} className="mb-2 last:mb-0">{line}</p>
                                ))}
                              </div>
                            )}
                          </motion.div>
                        )}

                        <div className="max-w-none">
                          <div 
                            className="text-serenity-charcoal/90 font-serif leading-relaxed space-y-6 sm:space-y-10"
                            style={{ 
                              fontSize: `${articleFontSize}px`,
                              lineHeight: articleLineSpacing
                            }}
                          >
                            {articles.find(a => a.id === selectedArticle)?.content.split('\n\n').map((para, i) => (
                              <p key={i} className="first-letter:text-4xl first-letter:font-serif first-letter:float-left first-letter:mr-3 first-letter:text-serenity-blue first-line:uppercase first-line:tracking-widest first-line:text-[0.6em] first-line:font-bold">
                                {para}
                              </p>
                            ))}
                          </div>
                        </div>
                        
                        <div className="mt-16 sm:mt-24 pt-10 border-t border-serenity-charcoal/5 flex flex-col sm:flex-row items-center justify-between gap-8">
                          <div className="flex items-center gap-4 w-full sm:w-auto">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-serenity-blue/10 flex items-center justify-center text-serenity-blue border border-serenity-blue/20 shrink-0">
                              <BookOpen size={20} />
                            </div>
                            <div>
                              <p className="text-[8px] sm:text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Article Source</p>
                              <p className="text-xs sm:text-sm font-medium text-serenity-charcoal">{articles.find(a => a.id === selectedArticle)?.source}</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => {
                              setArticlesReadCount(c => c + 1);
                              setSelectedArticle(null);
                            }}
                            className="btn-primary w-full sm:w-auto py-4 px-10"
                          >
                            Finish Reading
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {activeTab === "Progress" && (
          <div className="w-full max-w-6xl px-4">
            <div className="text-center mb-16">
              <h1 className="text-4xl sm:text-7xl font-serif text-serenity-charcoal mb-4 tracking-tight leading-tight">Your Progress</h1>
              <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-lg mx-auto uppercase tracking-[0.4em]">
                Consistency is the foundation of peace.
              </p>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
              <div className="premium-card p-8 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-serenity-blue/5 rounded-2xl flex items-center justify-center text-serenity-blue mb-4">
                  <Waves size={24} />
                </div>
                <div className="text-3xl font-serif text-serenity-charcoal mb-1">{breathingSessions}</div>
                <div className="text-[10px] font-bold text-serenity-charcoal/30 uppercase tracking-widest">Breathing Sessions</div>
              </div>
              <div className="premium-card p-8 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-serenity-gold/5 rounded-2xl flex items-center justify-center text-serenity-gold mb-4">
                  <PenLine size={24} />
                </div>
                <div className="text-3xl font-serif text-serenity-charcoal mb-1">{filteredEntries.length}</div>
                <div className="text-[10px] font-bold text-serenity-charcoal/30 uppercase tracking-widest">Journal Entries</div>
              </div>
              <div className="premium-card p-8 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-serenity-mint/5 rounded-2xl flex items-center justify-center text-serenity-mint mb-4">
                  <BookOpen size={24} />
                </div>
                <div className="text-3xl font-serif text-serenity-charcoal mb-1">{articlesReadCount}</div>
                <div className="text-[10px] font-bold text-serenity-charcoal/30 uppercase tracking-widest">Articles Read</div>
              </div>
              <div className="premium-card p-8 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-serenity-coral/5 rounded-2xl flex items-center justify-center text-serenity-coral mb-4">
                  <Wind size={24} />
                </div>
                <div className="text-3xl font-serif text-serenity-charcoal mb-1">{activities.filter(a => a.completed).length}</div>
                <div className="text-[10px] font-bold text-serenity-charcoal/30 uppercase tracking-widest">Activities Finished</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              {/* Activity Consistency Line Chart */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="premium-card p-10 lg:col-span-2"
              >
                <div className="mb-10">
                  <h3 className="text-2xl font-serif text-serenity-charcoal mb-2">Activity Consistency</h3>
                  <p className="text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Reflections over the last 14 days</p>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={
                      Array.from({ length: 14 }).map((_, i) => {
                        const date = format(subDays(new Date(), 13 - i), 'MMM dd');
                        const count = filteredEntries.filter(e => format(parseISO(e.date), 'MMM dd') === date).length;
                        return { date, count };
                      })
                    }>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 700 }}
                        dy={10}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false}
                        tick={{ fill: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 700 }}
                        ticks={[0, 1, 2, 3, 4, 5]}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#fff', 
                          border: 'none', 
                          borderRadius: '16px',
                          padding: '12px 16px',
                          boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
                        }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="count" 
                        stroke="#8AA6A3" 
                        strokeWidth={4} 
                        dot={{ fill: '#8AA6A3', strokeWidth: 2, r: 6, stroke: '#fff' }}
                        activeDot={{ r: 8, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>

              {/* Tool Engagement Chart */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="premium-card p-10"
              >
                <div className="mb-10">
                  <h3 className="text-2xl font-serif text-serenity-charcoal mb-2">Toolkit Engagement</h3>
                  <p className="text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Usage breakdown</p>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: 'Breathe', count: breathingSessions, fill: '#8AA6A3' },
                      { name: 'Journal', count: filteredEntries.length, fill: '#D4AF37' },
                      { name: 'Learn', count: articlesReadCount, fill: '#E0F2F1' },
                      { name: 'Planner', count: activities.filter(a => a.completed).length, fill: '#F43F5E' },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} dy={10} />
                      <Bar dataKey="count" radius={[8, 8, 0, 0]} />
                      <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </motion.div>

              {/* Mood Distribution Pie Chart */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="premium-card p-10"
              >
                <div className="mb-10">
                  <h3 className="text-2xl font-serif text-serenity-charcoal mb-2">Mood Distribution</h3>
                  <p className="text-[10px] font-bold text-serenity-coral uppercase tracking-[0.3em]">Emotional variety in your reflections</p>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Peaceful', value: filteredEntries.filter(e => e.mood === 'Peaceful').length || 1 },
                          { name: 'Stable', value: filteredEntries.filter(e => e.mood === 'Stable').length || 1 },
                          { name: 'Anxious', value: filteredEntries.filter(e => e.mood === 'Anxious').length || 1 },
                          { name: 'Heavy', value: filteredEntries.filter(e => e.mood === 'Heavy').length || 1 },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={8}
                        dataKey="value"
                      >
                        <Cell fill="#8AA6A3" />
                        <Cell fill="#94A3B8" />
                        <Cell fill="#F43F5E" />
                        <Cell fill="#1E293B" />
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#fff', 
                          border: 'none', 
                          borderRadius: '16px',
                          padding: '12px 16px',
                          boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-6 mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-serenity-blue" />
                    <span className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Peaceful</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-slate-400" />
                    <span className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Stable</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-serenity-coral" />
                    <span className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Anxious</span>
                  </div>
                </div>
              </motion.div>
            </div>
            
            <div className="mt-12 bg-serenity-blue/5 rounded-[40px] p-12 text-center border border-serenity-blue/10">
              <Sparkles className="text-serenity-blue mx-auto mb-6" size={32} />
              <h3 className="text-3xl font-serif text-serenity-charcoal mb-4">You're making real progress.</h3>
              <p className="text-serenity-charcoal/60 max-w-2xl mx-auto leading-relaxed font-light">
                Every breath taken and every thought reframed is a step toward a more resilient you. Keep showing up for yourself.
              </p>
            </div>
          </div>
        )}

        {activeTab === "Self-check" && (
          <div className="w-full max-w-4xl px-4">
            <AnimatePresence mode="wait">
              {selfCheckStep === null ? (
                <motion.div
                  key="check-intro"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="text-center"
                >
                  <div className="w-20 h-20 bg-serenity-blue/10 rounded-[32px] flex items-center justify-center mx-auto mb-10 border border-serenity-blue/20">
                    <Activity className="text-serenity-blue" size={40} />
                  </div>
                  <h2 className="text-4xl sm:text-7xl font-serif text-serenity-charcoal mb-6 tracking-tight leading-tight">Mood Self-Check</h2>
                  <p className="text-serenity-charcoal/30 text-[10px] font-bold mb-10 max-w-lg mx-auto leading-relaxed uppercase tracking-[0.4em]">
                    Reflect on your well-being. Awareness is the first step.
                  </p>
                  <div className="flex justify-center">
                    <button
                      onClick={() => setSelfCheckStep(0)}
                      className="btn-primary px-16 py-5 text-lg"
                    >
                      Start Check
                    </button>
                  </div>
                  <p className="mt-10 text-[10px] text-serenity-charcoal/30 font-bold uppercase tracking-[0.2em]">
                    Your responses are private and not stored.
                  </p>
                </motion.div>
              ) : selfCheckStep < moodQuestions.length ? (
                <motion.div
                  key={`question-${selfCheckStep}`}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="premium-card p-10 sm:p-20"
                >
                  <div className="mb-16">
                    <div className="flex justify-between items-end mb-6">
                      <div>
                        <span className="text-serenity-blue text-[10px] font-bold uppercase tracking-[0.3em] block mb-2">Question {selfCheckStep + 1} of {moodQuestions.length}</span>
                        <h3 className="text-2xl sm:text-4xl font-serif text-serenity-charcoal leading-tight">
                          {moodQuestions[selfCheckStep].question}
                        </h3>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-serenity-charcoal/5 rounded-full overflow-hidden border border-serenity-charcoal/5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${((selfCheckStep + 1) / moodQuestions.length) * 100}%` }}
                        className="h-full bg-serenity-blue"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    {moodQuestions[selfCheckStep].options.map((option, index) => (
                      <button
                        key={index}
                        onClick={() => {
                          setSelfCheckScores([...selfCheckScores, index]);
                          setSelfCheckStep(selfCheckStep + 1);
                        }}
                        className="w-full p-6 text-left rounded-3xl border border-serenity-charcoal/5 bg-serenity-cream hover:border-serenity-blue/30 hover:bg-serenity-blue/5 transition-all group flex items-center justify-between"
                      >
                        <span className="text-lg font-light text-serenity-charcoal/80 group-hover:text-serenity-charcoal transition-colors">{option}</span>
                        <div className="w-6 h-6 rounded-full border border-serenity-charcoal/20 group-hover:border-serenity-blue/30 flex items-center justify-center transition-all">
                          <div className="w-2 h-2 rounded-full bg-serenity-blue scale-0 group-hover:scale-100 transition-transform" />
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="check-result"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="premium-card p-10 sm:p-20 text-center"
                >
                  <div className={`text-[10px] sm:text-sm font-bold uppercase tracking-[0.3em] mb-6 ${getMoodResult().color}`}>
                    Your Result
                  </div>
                  <h3 className="text-3xl sm:text-5xl font-serif text-serenity-charcoal mb-8">
                    {getMoodResult().title}
                  </h3>
                  <p className="text-serenity-charcoal/70 text-lg sm:text-xl mb-12 leading-relaxed font-light">
                    {getMoodResult().desc}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button
                      onClick={() => {
                        setSelfCheckStep(null);
                        setSelfCheckScores([]);
                      }}
                      className="btn-secondary"
                    >
                      Retake Check
                    </button>
                    <button
                      onClick={() => setActiveTab("Tools")}
                      className="btn-primary"
                    >
                      Go to Tools
                    </button>
                  </div>
                  <div className="mt-16 pt-10 border-t border-serenity-charcoal/5 text-[10px] text-serenity-charcoal/30 font-bold uppercase tracking-[0.2em] leading-relaxed">
                    DISCLAIMER: This self-check is for informational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {activeTab === "Journal" && (
          <div className="w-full max-w-6xl px-4">
            <div className="text-center mb-12">
              <h2 className="text-5xl sm:text-7xl font-serif text-serenity-charcoal mb-6 tracking-tight leading-tight">Mood Journal</h2>
              <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-lg mx-auto uppercase tracking-[0.4em]">
                Log your thoughts, track your moods, and find patterns in your well-being.
              </p>
            </div>

            <div className="flex justify-center mb-10 px-0 sm:px-4">
              <div className="glass p-1 rounded-2xl flex flex-wrap md:flex-nowrap gap-1 w-full sm:w-auto">
                <button
                  onClick={() => setJournalView("entries")}
                  className={`flex-1 sm:flex-none px-3 sm:px-8 py-3 rounded-xl text-[9px] sm:text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    journalView === "entries" ? "bg-serenity-charcoal/5 text-serenity-charcoal shadow-lg border border-serenity-charcoal/5" : "text-serenity-charcoal/40 hover:text-serenity-charcoal hover:bg-serenity-charcoal/5"
                  }`}
                >
                  <List size={14} className="shrink-0" />
                  Entries
                </button>
                <button
                  onClick={() => setJournalView("trends")}
                  className={`flex-1 sm:flex-none px-3 sm:px-8 py-3 rounded-xl text-[9px] sm:text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    journalView === "trends" ? "bg-serenity-charcoal/5 text-serenity-charcoal shadow-lg border border-serenity-charcoal/5" : "text-serenity-charcoal/40 hover:text-serenity-charcoal hover:bg-serenity-charcoal/5"
                  }`}
                >
                  <TrendingUp size={14} className="shrink-0" />
                  Trends
                </button>
                <button
                  onClick={() => setShowReminderSettings(!showReminderSettings)}
                  className={`flex-1 sm:flex-none px-3 sm:px-8 py-3 rounded-xl text-[9px] sm:text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    showReminderSettings ? "bg-serenity-blue text-white shadow-lg border border-serenity-blue/20" : "text-serenity-charcoal/40 hover:text-serenity-charcoal hover:bg-serenity-charcoal/5"
                  }`}
                >
                  <Clock size={14} className="shrink-0" />
                  Reminders
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showReminderSettings && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-12"
                >
                  <div className="premium-card p-5 sm:p-8 bg-serenity-blue/5 border-serenity-blue/20">
                    <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 sm:gap-8">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 sm:w-14 sm:h-14 bg-serenity-cream rounded-2xl flex items-center justify-center shadow-sm border border-serenity-charcoal/5 shrink-0">
                          <Clock className="text-serenity-blue" size={20} />
                        </div>
                        <div>
                          <h3 className="text-base sm:text-lg font-serif text-serenity-charcoal">Reminders</h3>
                          <p className="text-[8px] sm:text-[10px] font-bold text-serenity-blue uppercase tracking-widest">Reflection Alerts</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-start lg:justify-end gap-4 sm:gap-6 w-full lg:w-auto">
                        <div className="flex items-center gap-3">
                          <label className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Enabled</label>
                          <button
                            onClick={() => setReminder({ ...reminder, enabled: !reminder.enabled })}
                            className={`w-12 h-6 rounded-full transition-all relative ${reminder.enabled ? "bg-serenity-blue" : "bg-serenity-charcoal/10"}`}
                          >
                            <motion.div
                              animate={{ x: reminder.enabled ? 26 : 2 }}
                              className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                            />
                          </button>
                        </div>

                        <div className="flex items-center gap-3">
                          <label className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Time</label>
                          <input
                            type="time"
                            value={reminder.time}
                            onChange={(e) => setReminder({ ...reminder, time: e.target.value })}
                            className="bg-serenity-cream border border-serenity-charcoal/5 rounded-xl px-4 py-2 text-sm font-medium text-serenity-charcoal focus:ring-2 focus:ring-serenity-blue/20 outline-none"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <label className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest">Frequency</label>
                          <select
                            value={reminder.frequency}
                            onChange={(e) => setReminder({ ...reminder, frequency: e.target.value as "daily" | "weekly" })}
                            className="bg-serenity-cream border border-serenity-charcoal/5 rounded-xl px-4 py-2 text-sm font-medium text-serenity-charcoal focus:ring-2 focus:ring-serenity-blue/20 outline-none"
                          >
                            <option value="daily" className="bg-serenity-cream">Daily</option>
                            <option value="weekly" className="bg-serenity-cream">Weekly</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {journalView === "entries" ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                {/* Entry Form */}
                <div className="md:col-span-1">
                  <div className="premium-card p-6 sm:p-8 md:sticky md:top-32">
                    <h3 className="text-xl sm:text-2xl font-serif text-serenity-charcoal mb-8">New Entry</h3>
                    
                    <div className="space-y-8">
                      <div>
                        <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em] mb-4">How are you feeling?</label>
                        <div className="flex flex-wrap gap-3">
                          {moods.map((m) => (
                            <button
                              key={m.name}
                              onClick={() => setJournalMood(m.name)}
                              className={`flex-1 min-w-[80px] p-3 rounded-2xl border transition-all flex flex-col items-center gap-2 ${
                                journalMood === m.name 
                                  ? `${m.color} text-white border-transparent shadow-lg` 
                                  : "bg-serenity-charcoal/5 border-serenity-charcoal/5 text-serenity-charcoal/40 hover:border-serenity-blue/20"
                              }`}
                            >
                              <span className="text-xl">{m.icon}</span>
                              <span className="text-[10px] font-bold uppercase tracking-widest">{m.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em] mb-4">Reflections</label>
                        <textarea
                          value={journalContent}
                          onChange={(e) => setJournalContent(e.target.value)}
                          placeholder="What's on your mind today?"
                          className="w-full bg-serenity-charcoal/5 border border-serenity-charcoal/5 rounded-2xl p-6 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all min-h-[200px] resize-none font-light text-lg outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em] mb-4">Tags (comma separated)</label>
                        <input
                          type="text"
                          value={journalTags}
                          onChange={(e) => setJournalTags(e.target.value)}
                          placeholder="e.g. work, family, gratitude"
                          className="w-full bg-serenity-charcoal/5 border border-serenity-charcoal/5 rounded-2xl px-6 py-4 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all font-light text-lg outline-none"
                        />
                      </div>

                      <button
                        onClick={handleAddEntry}
                        disabled={!journalContent.trim()}
                        className="btn-primary w-full py-5 text-lg disabled:opacity-50 relative overflow-hidden"
                      >
                        <AnimatePresence mode="wait">
                          {showSaveSuccess ? (
                            <motion.div
                              key="success"
                              initial={{ y: 20, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              exit={{ y: -20, opacity: 0 }}
                              className="flex items-center justify-center gap-2"
                            >
                              <CheckCircle2 size={20} />
                              Saved Successfully
                            </motion.div>
                          ) : (
                            <motion.div
                              key="idle"
                              initial={{ y: 20, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              exit={{ y: -20, opacity: 0 }}
                            >
                              {user ? "Save Entry" : "Login to Save"}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </button>

                      <AnimatePresence>
                        {journalValidationError && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="p-4 bg-serenity-coral/10 border border-serenity-coral/20 rounded-xl text-center"
                          >
                            <p className="text-serenity-coral text-sm font-medium">{journalValidationError}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Entries List */}
                <div className="md:col-span-2 space-y-8">
                  <AnimatePresence initial={false} mode="popLayout">
                    {journalEntries.length === 0 ? (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="premium-card p-20 text-center bg-serenity-cream/50 border-dashed border-2 flex flex-col items-center justify-center"
                      >
                        <div className="w-24 h-24 bg-serenity-blue/5 rounded-[40px] flex items-center justify-center mb-8 border border-serenity-blue/10">
                          <Sparkles className="text-serenity-blue/40" size={40} />
                        </div>
                        <h3 className="text-3xl font-serif text-serenity-charcoal mb-4">Your Story Begins Here</h3>
                        <p className="text-serenity-charcoal/40 font-light max-w-sm mx-auto leading-relaxed">
                          Every journey starts with a single reflection. Take a moment to breathe and log your first entry in this safe, private space.
                        </p>
                      </motion.div>
                    ) : (
                      journalEntries.map((entry, index) => (
                        <motion.div
                          key={entry.id}
                          layout
                          initial={{ opacity: 0, y: 30, scale: 0.98 }}
                          animate={{ 
                            opacity: 1, 
                            y: 0, 
                            scale: 1,
                            transition: {
                              type: "spring",
                              stiffness: 100,
                              damping: 15,
                              delay: index * 0.05
                            }
                          }}
                          exit={{ 
                            opacity: 0, 
                            x: -20, 
                            scale: 0.95,
                            transition: { duration: 0.2 }
                          }}
                          whileHover={{ 
                            y: -4,
                            boxShadow: "0 20px 40px -10px rgba(0,0,0,0.2)",
                            transition: { duration: 0.2 }
                          }}
                          className="premium-card p-5 sm:p-10 group cursor-default shadow-sm hover:shadow-xl transition-all"
                        >
                          <div className="flex justify-between items-start mb-6 sm:mb-8">
                            <div className="flex items-center gap-3 sm:gap-4">
                              <motion.div 
                                whileHover={{ scale: 1.1, rotate: 5 }}
                                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center text-xl sm:text-2xl ${
                                  moods.find(m => m.name === entry.mood)?.color || "bg-serenity-slate"
                                } text-white shadow-md`}
                              >
                                {moods.find(m => m.name === entry.mood)?.icon}
                              </motion.div>
                              <div>
                                <p className="text-[8px] sm:text-[10px] font-bold text-serenity-blue uppercase tracking-widest mb-0.5 sm:mb-1">{entry.date}</p>
                                <h4 className="text-lg sm:text-xl font-serif text-serenity-charcoal">{entry.mood}</h4>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="relative">
                                <button
                                  onClick={() => setActiveShareId(activeShareId === entry.id ? null : entry.id)}
                                  className={`p-2 transition-colors rounded-lg ${activeShareId === entry.id ? "bg-serenity-blue/10 text-serenity-blue" : "text-serenity-charcoal/10 hover:text-serenity-blue hover:bg-serenity-blue/5"}`}
                                  aria-label="Share entry"
                                >
                                  <Share2 size={20} />
                                </button>

                                <AnimatePresence>
                                  {activeShareId === entry.id && (
                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                      animate={{ opacity: 1, scale: 1, y: 0 }}
                                      exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                      className="absolute right-0 top-full mt-2 glass rounded-2xl shadow-2xl p-2 z-50 min-w-[180px] border border-serenity-charcoal/5"
                                    >
                                      <div className="flex flex-col gap-1">
                                        <button
                                          onClick={() => handleShare(entry, 'copy')}
                                          className="flex items-center gap-3 px-4 py-3 hover:bg-serenity-charcoal/5 rounded-xl transition-colors text-left group"
                                        >
                                          <div className="w-8 h-8 bg-serenity-charcoal/5 rounded-lg flex items-center justify-center text-serenity-blue group-hover:bg-serenity-charcoal/10">
                                            {copiedId === entry.id ? <Check size={16} /> : <Copy size={16} />}
                                          </div>
                                          <span className="text-sm font-medium text-serenity-charcoal">
                                            {copiedId === entry.id ? "Copied!" : "Copy Text"}
                                          </span>
                                        </button>
                                        <button
                                          onClick={() => handleShare(entry, 'twitter')}
                                          className="flex items-center gap-3 px-4 py-3 hover:bg-serenity-charcoal/5 rounded-xl transition-colors text-left group"
                                        >
                                          <div className="w-8 h-8 bg-sky-500/10 rounded-lg flex items-center justify-center text-sky-400 group-hover:bg-sky-500/20">
                                            <Twitter size={16} />
                                          </div>
                                          <span className="text-sm font-medium text-serenity-charcoal">Share on Twitter</span>
                                        </button>
                                        <button
                                          onClick={() => handleShare(entry, 'linkedin')}
                                          className="flex items-center gap-3 px-4 py-3 hover:bg-serenity-charcoal/5 rounded-xl transition-colors text-left group"
                                        >
                                          <div className="w-8 h-8 bg-blue-600/10 rounded-lg flex items-center justify-center text-blue-400 group-hover:bg-blue-600/20">
                                            <Linkedin size={16} />
                                          </div>
                                          <span className="text-sm font-medium text-serenity-charcoal">Share on LinkedIn</span>
                                        </button>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                             <SerenityTooltip text="Permanently Delete Reflection">
                               <button
                                 onClick={() => handleDeleteEntry(entry.id)}
                                 className="p-2 text-serenity-charcoal/10 hover:text-serenity-coral transition-colors rounded-lg hover:bg-serenity-coral/5"
                                 aria-label="Delete entry"
                               >
                                 <Trash2 size={20} />
                               </button>
                             </SerenityTooltip>
                            </div>
                          </div>
                          
                          <p className="text-serenity-charcoal/80 text-xl font-light leading-relaxed mb-8 whitespace-pre-wrap">
                            {entry.content}
                          </p>

                          {entry.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {entry.tags.map((tag, i) => (
                                <motion.span 
                                  key={i} 
                                  whileHover={{ scale: 1.05, backgroundColor: "rgba(0, 0, 0, 0.05)" }}
                                  className="px-3 py-1 bg-serenity-charcoal/5 rounded-full text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest cursor-default border border-serenity-charcoal/5"
                                >
                                  #{tag}
                                </motion.span>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ) : (
              <div className="space-y-12">
                {/* Visualization Filters */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="premium-card p-4 sm:p-6 flex flex-col sm:flex-row flex-wrap items-center justify-center lg:justify-between gap-6"
                >
                  <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-4 sm:gap-6 w-full sm:w-auto">
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-center sm:justify-start">
                      <label className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest shrink-0">Range</label>
                      <div className="flex bg-serenity-charcoal/5 p-1 rounded-xl border border-serenity-charcoal/5 w-full sm:w-auto">
                        {(["7d", "30d", "all"] as const).map((range) => (
                          <button
                            key={range}
                            onClick={() => setTrendDateRange(range)}
                            className={`flex-1 sm:flex-none px-2 sm:px-4 py-1.5 rounded-lg text-[9px] sm:text-[10px] font-bold uppercase tracking-wider transition-all ${
                              trendDateRange === range ? "bg-serenity-blue text-white shadow-lg" : "text-serenity-charcoal/40 hover:text-serenity-charcoal"
                            }`}
                          >
                            {range === "7d" ? "7d" : range === "30d" ? "30d" : "All"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-bold text-serenity-charcoal/40 uppercase tracking-widest shrink-0">Filter Tag</label>
                      <select
                        value={trendTagFilter}
                        onChange={(e) => setTrendTagFilter(e.target.value)}
                        className="bg-serenity-charcoal/5 border border-serenity-charcoal/5 rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-serenity-charcoal focus:ring-2 focus:ring-serenity-blue/20 outline-none w-full sm:w-auto sm:max-w-none"
                      >
                        <option value="all" className="bg-serenity-cream">All Tags</option>
                        {allTags.map(tag => (
                          <option key={tag} value={tag} className="bg-serenity-cream">{tag}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em] text-center w-full lg:w-auto">
                    Showing {filteredEntries.length} entries
                  </div>
                </motion.div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="premium-card p-6 sm:p-10"
                  >
                    <div className="mb-8 sm:mb-10">
                      <h3 className="text-xl sm:text-2xl font-serif text-serenity-charcoal mb-2">Mood Trend</h3>
                      <p className="text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Your emotional journey</p>
                    </div>
                    <div className="h-[250px] sm:h-[300px] w-full">
                      {trendData.length > 1 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                            <XAxis 
                              dataKey="date" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fill: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 700 }}
                              dy={10}
                            />
                            <YAxis 
                              domain={[1, 5]} 
                              ticks={[1, 2, 3, 4, 5]}
                              axisLine={false} 
                              tickLine={false}
                              tick={{ fill: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 700 }}
                              tickFormatter={(val) => moods.find(m => m.value === val)?.name || ''}
                            />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: '#fff', 
                                border: 'none', 
                                borderRadius: '16px',
                                color: '#1E293B',
                                padding: '12px 16px',
                                boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
                              }}
                              itemStyle={{ color: '#1E293B', fontSize: '12px', fontWeight: 600 }}
                              labelStyle={{ display: 'none' }}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="value" 
                              stroke="#8AA6A3" 
                              strokeWidth={4} 
                              dot={{ r: 6, fill: '#8AA6A3', strokeWidth: 2, stroke: '#fff' }}
                              activeDot={{ r: 8, fill: '#8AA6A3', strokeWidth: 0 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6">
                          <div className="w-16 h-16 bg-serenity-blue/5 rounded-2xl flex items-center justify-center mb-6 border border-serenity-blue/10">
                            <TrendingUp className="text-serenity-blue/30" size={24} />
                          </div>
                          <p className="text-serenity-charcoal/40 font-light italic max-w-[200px] leading-relaxed">
                            Patterns emerge over time. Log at least two entries to visualize your emotional journey.
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="premium-card p-10"
                  >
                    <div className="mb-10">
                      <h3 className="text-2xl font-serif text-serenity-charcoal mb-2">Top Reflections</h3>
                      <p className="text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Most frequent themes</p>
                    </div>
                    <div className="h-[250px] sm:h-[300px] w-full">
                      {tagData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={tagData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(0,0,0,0.05)" />
                            <XAxis type="number" hide />
                            <YAxis 
                              dataKey="name" 
                              type="category" 
                              axisLine={false} 
                              tickLine={false}
                              tick={{ fill: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 700 }}
                              width={80}
                            />
                            <Tooltip 
                              cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                              contentStyle={{ 
                                backgroundColor: '#fff', 
                                border: 'none', 
                                borderRadius: '16px',
                                padding: '12px 16px',
                                boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
                              }}
                            />
                            <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={12} fill="#8AA6A3" />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6">
                          <div className="w-16 h-16 bg-serenity-blue/5 rounded-2xl flex items-center justify-center mb-6 border border-serenity-blue/10">
                            <Hash className="text-serenity-blue/30" size={24} />
                          </div>
                          <p className="text-serenity-charcoal/40 font-light italic max-w-[200px] leading-relaxed">
                            Discover your recurring themes. Add tags like #gratitude or #work to your entries to see what shapes your days.
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="premium-card p-6 sm:p-10"
                  >
                    <div className="mb-8 sm:mb-10">
                      <h3 className="text-xl sm:text-2xl font-serif text-serenity-charcoal mb-2">Tag Correlation</h3>
                      <p className="text-[10px] font-bold text-serenity-gold uppercase tracking-[0.3em]">Emotional impact per theme</p>
                    </div>
                    <div className="h-[250px] sm:h-[300px] w-full">
                      {tagCorrelations.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={tagCorrelations} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="rgba(0,0,0,0.05)" />
                            <XAxis type="number" hide domain={[0, 5]} />
                            <YAxis 
                              dataKey="tag" 
                              type="category" 
                              axisLine={false} 
                              tickLine={false}
                              width={80}
                              tick={{ fill: 'rgba(0,0,0,0.4)', fontSize: 10, fontWeight: 700 }}
                            />
                            <Tooltip 
                              cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                              contentStyle={{ 
                                backgroundColor: '#fff', 
                                border: 'none', 
                                borderRadius: '16px',
                                padding: '12px 16px',
                                boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
                              }}
                              formatter={(value: number) => [`${value} (Avg Mood)`, 'Score']}
                            />
                            <Bar 
                              dataKey="avgMood" 
                              radius={[0, 8, 8, 0]} 
                              barSize={12}
                              fill="#D4AF37"
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6">
                          <div className="w-16 h-16 bg-serenity-gold/5 rounded-2xl flex items-center justify-center mb-6 border border-serenity-gold/10">
                            <Sparkles className="text-serenity-gold/30" size={24} />
                          </div>
                          <p className="text-serenity-charcoal/40 font-light italic max-w-[200px] leading-relaxed">
                            Analyze the deeper patterns. Combining moods and tags reveals how different parts of your life affect your peace.
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </div>

                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="premium-card p-10"
                >
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-serenity-blue/10 rounded-2xl flex items-center justify-center border border-serenity-blue/20">
                      <TrendingUp className="text-serenity-blue" size={32} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-serif text-serenity-charcoal mb-2">Serenity Insight</h3>
                      <p className="text-serenity-charcoal/60 font-light text-lg">
                        {filteredEntries.length > 0 
                          ? `You've logged ${filteredEntries.length} reflections in this view. Your most frequent mood is "${mostFrequentMood}".`
                          : "Start logging your daily thoughts to unlock personalized well-being insights."
                        }
                      </p>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        )}

        {activeTab === "About" && (
          <div className="w-full max-w-5xl text-center px-4">
            <div className="mb-20">
              <h2 className="text-5xl sm:text-7xl font-serif text-serenity-charcoal mb-8 tracking-tight leading-tight">About Serenity Hub</h2>
              <p className="text-serenity-charcoal/30 text-[10px] font-bold max-w-2xl mx-auto leading-relaxed uppercase tracking-[0.4em]">
                A digital sanctuary for mental well-being and immediate relief.
              </p>
            </div>
            <p className="text-2xl sm:text-3xl text-serenity-charcoal/80 font-light leading-relaxed mb-20 max-w-4xl mx-auto">
              Serenity Hub is designed to provide immediate relief and long-term resources for mental well-being. Our mission is to make grounding tools and professional support accessible to everyone, everywhere.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 sm:gap-12">
              <div className="premium-card p-10 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-serenity-blue/5 rounded-2xl flex items-center justify-center mb-8 border border-serenity-blue/10">
                  <Activity className="text-serenity-blue" size={32} />
                </div>
                <h4 className="text-xl font-serif text-serenity-charcoal mb-4">Evidence-Based</h4>
                <p className="text-sm text-serenity-charcoal/50 font-light leading-relaxed">
                  Every tool in our sanctuary is rooted in Cognitive Behavioral Therapy and Mindfulness practices.
                </p>
              </div>
              <div className="premium-card p-10 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-serenity-blue/5 rounded-2xl flex items-center justify-center mb-8 border border-serenity-blue/10">
                  <ShieldCheck className="text-serenity-blue" size={32} />
                </div>
                <h4 className="text-xl font-serif text-serenity-charcoal mb-4">Privacy-First</h4>
                <p className="text-sm text-serenity-charcoal/50 font-light leading-relaxed">
                  Your reflections are your own. We prioritize local processing and anonymous interactions.
                </p>
              </div>
              <div className="premium-card p-10 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-serenity-blue/5 rounded-2xl flex items-center justify-center mb-8 border border-serenity-blue/10">
                  <Globe className="text-serenity-blue" size={32} />
                </div>
                <h4 className="text-xl font-serif text-serenity-charcoal mb-4">Accessibility</h4>
                <p className="text-sm text-serenity-charcoal/50 font-light leading-relaxed">
                  Support is a universal right. We strive to provide immediate relief tools that work for everyone.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-32 px-6 border-t border-serenity-charcoal/5 text-center bg-serenity-cream">
        <div className="text-3xl sm:text-4xl font-serif text-serenity-charcoal mb-12">
          Serenity Hub
        </div>
        <div className="flex flex-wrap justify-center gap-8 sm:gap-16 text-[10px] font-bold uppercase tracking-[0.4em] text-serenity-charcoal/30 mb-16">
          <button onClick={() => setLegalView("privacy")} className="hover:text-serenity-blue transition-colors">Privacy Policy</button>
          <button onClick={() => setLegalView("terms")} className="hover:text-serenity-blue transition-colors">Terms of Service</button>
          <button onClick={() => setActiveTab("Find Support")} className="hover:text-serenity-blue transition-colors">Emergency Contacts</button>
        </div>
        <div className="max-w-2xl mx-auto">
          <p className="text-[10px] text-serenity-charcoal/20 leading-relaxed uppercase tracking-[0.3em] mb-4">
            © 2026 Editorial Serenity. Not a medical substitute.
          </p>
          <p className="text-[10px] text-serenity-charcoal/20 leading-relaxed uppercase tracking-[0.3em]">
            If you are in immediate danger, please contact local emergency services or call 988.
          </p>
        </div>
      </footer>

      <AnimatePresence>
        {legalView && (
          <LegalModal type={legalView} onClose={() => setLegalView(null)} />
        )}
      </AnimatePresence>

      {/* Login Modal */}
      <AnimatePresence>
        {isLoginModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-serenity-charcoal/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="premium-card max-w-sm w-full p-8 text-center"
            >
              <div className="w-16 h-16 bg-serenity-blue/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Asterisk className="text-serenity-blue" size={32} />
              </div>
              <h3 className="text-2xl font-serif text-serenity-charcoal mb-2">Welcome Back</h3>
              <p className="text-serenity-charcoal/40 text-sm mb-8">Sign in to sync your journey across all devices.</p>
              
              <div className="flex items-center justify-center gap-3 mb-8">
                <button 
                  onClick={() => setRememberMe(!rememberMe)}
                  className={`w-12 h-6 rounded-full transition-all relative ${rememberMe ? "bg-serenity-blue" : "bg-serenity-charcoal/10"}`}
                >
                  <motion.div
                    animate={{ x: rememberMe ? 26 : 2 }}
                    className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                  />
                </button>
                <span className="text-[10px] font-bold text-serenity-charcoal/60 uppercase tracking-[0.2em]">Remember Me</span>
              </div>

                <button 
                  onClick={handleLogin}
                  disabled={isLoggingIn}
                  className="btn-primary w-full py-4 text-sm flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {isLoggingIn ? (
                    <Loader2 className="animate-spin" size={18} />
                  ) : (
                    <>
                      <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
                      Continue with Google
                    </>
                  )}
                </button>
              
              <button 
                onClick={() => setIsLoginModalOpen(false)}
                className="mt-6 text-[10px] font-bold text-serenity-charcoal/30 uppercase tracking-[0.2em] hover:text-serenity-charcoal transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile Setup Modal */}
      <AnimatePresence>
        {isProfileSetupOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-serenity-charcoal/90 backdrop-blur-md"
          >
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="premium-card max-w-2xl w-full p-6 sm:p-12 max-h-[95vh] overflow-y-auto"
            >
              <div className="text-center mb-10">
                <div className="w-16 h-16 bg-serenity-blue/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-serenity-blue/20">
                  <Activity className="text-serenity-blue" size={32} />
                </div>
                <h3 className="text-3xl sm:text-4xl font-serif text-serenity-charcoal mb-3">Begin Your Journey</h3>
                <p className="text-serenity-charcoal/50 text-base sm:text-lg font-light leading-relaxed max-w-md mx-auto">
                  To provide the best support, we'd love to know a little more about your wellness goals.
                </p>
              </div>
              
              <div className="space-y-10">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Wellness Focus</label>
                    <div className="grid grid-cols-1 gap-2">
                      {["Stress", "Anxiety", "Sleep", "Mindset", "Physical"].map((focus) => (
                        <button
                          key={focus}
                          onClick={() => setProfileWellnessFocus(focus)}
                          className={`px-4 py-3 rounded-xl border text-sm transition-all text-left ${
                            profileWellnessFocus === focus 
                              ? "bg-serenity-blue/10 border-serenity-blue text-serenity-blue font-medium" 
                              : "border-serenity-charcoal/5 text-serenity-charcoal/40 hover:border-serenity-charcoal/20"
                          }`}
                        >
                          {focus}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Daily Commitment</label>
                    <div className="grid grid-cols-1 gap-2">
                      {["5 mins/day", "15 mins/day", "30+ mins/day"].map((time) => (
                        <button
                          key={time}
                          onClick={() => setProfileCommitment(time)}
                          className={`px-4 py-3 rounded-xl border text-sm transition-all text-left ${
                            profileCommitment === time 
                              ? "bg-serenity-blue/10 border-serenity-blue text-serenity-blue font-medium" 
                              : "border-serenity-charcoal/5 text-serenity-charcoal/40 hover:border-serenity-charcoal/20"
                          }`}
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">Core Intention</label>
                  <input 
                    type="text"
                    value={profileGoal}
                    onChange={(e) => setProfileGoal(e.target.value)}
                    placeholder="e.g. Find peace during work hours"
                    className="w-full bg-serenity-charcoal/5 border border-serenity-charcoal/5 rounded-2xl px-6 py-5 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all font-light text-lg outline-none"
                  />
                </div>

                <div className="space-y-4">
                  <label className="block text-[10px] font-bold text-serenity-blue uppercase tracking-[0.3em]">About Your Journey</label>
                  <textarea 
                    value={profileBio}
                    onChange={(e) => setProfileBio(e.target.value)}
                    placeholder="Tell us a little about yourself (optional but helpful)..."
                    className="w-full bg-serenity-charcoal/5 border border-serenity-charcoal/5 rounded-2xl p-6 text-serenity-charcoal placeholder:text-serenity-charcoal/20 focus:ring-2 focus:ring-serenity-blue/20 transition-all min-h-[160px] resize-none font-light text-lg outline-none"
                  />
                </div>

                <button 
                  onClick={handleUpdateProfile}
                  disabled={isSavingProfile || !profileGoal.trim()}
                  className="btn-primary w-full py-6 text-xl disabled:opacity-50 flex items-center justify-center shadow-xl shadow-serenity-blue/20"
                >
                  {isSavingProfile ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="animate-spin" size={24} />
                      <span>Creating Sanctuary...</span>
                    </div>
                  ) : "Complete Setup"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
