import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}

export const AnimatedBackground = () => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [stars, setStars] = useState<Star[]>([]);
  const [isNightMode, setIsNightMode] = useState(false);

  // Generate stars for night mode
  useEffect(() => {
    const generateStars = () => {
      const newStars: Star[] = [];
      for (let i = 0; i < 100; i++) {
        newStars.push({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: Math.random() * 3 + 1,
          duration: Math.random() * 3 + 2,
          delay: Math.random() * 2,
        });
      }
      setStars(newStars);
    };

    generateStars();
  }, []);

  // Load saved mode from localStorage on first render
  useEffect(() => {
    const savedMode = localStorage.getItem("nightMode");
    if (savedMode === "true") {
      document.documentElement.classList.add("night");
      setIsNightMode(true);
    } else if (savedMode === "false") {
      document.documentElement.classList.remove("night");
      setIsNightMode(false);
    }
  }, []);

  // Listen for night mode changes and save to localStorage
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const target = mutation.target as HTMLElement;
          const nightActive = target.classList.contains('night');
          setIsNightMode(nightActive);
          localStorage.setItem("nightMode", String(nightActive));
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // Track mouse movement
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Gradient Orbs - Day Mode */}
      {!isNightMode && (
        <>
          <motion.div
            className="absolute w-96 h-96 bg-primary/20 rounded-full blur-3xl"
            animate={{
              x: mousePosition.x * 2,
              y: mousePosition.y * 2,
            }}
            transition={{ type: "spring", stiffness: 50, damping: 30 }}
            style={{
              left: '10%',
              top: '20%',
            }}
          />
          <motion.div
            className="absolute w-80 h-80 bg-accent/30 rounded-full blur-3xl"
            animate={{
              x: mousePosition.x * -1.5,
              y: mousePosition.y * -1.5,
            }}
            transition={{ type: "spring", stiffness: 40, damping: 25 }}
            style={{
              right: '15%',
              bottom: '25%',
            }}
          />
          <motion.div
            className="absolute w-64 h-64 bg-secondary/40 rounded-full blur-2xl"
            animate={{
              x: mousePosition.x * 1,
              y: mousePosition.y * 1,
              rotate: mousePosition.x * 0.5,
            }}
            transition={{ type: "spring", stiffness: 60, damping: 20 }}
            style={{
              left: '60%',
              top: '60%',
            }}
          />
        </>
      )}

      {/* Starry Night Mode */}
      {isNightMode && (
        <div className="absolute inset-0">
          {/* Night Sky Gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 via-purple-900/10 to-blue-900/20" />
          
          {/* Animated Stars */}
          {stars.map((star) => (
            <motion.div
              key={star.id}
              className="absolute rounded-full bg-white"
              style={{
                left: `${star.x}%`,
                top: `${star.y}%`,
                width: `${star.size}px`,
                height: `${star.size}px`,
              }}
              animate={{
                opacity: [0.3, 1, 0.3],
                scale: [1, 1.2, 1],
              }}
              transition={{
                duration: star.duration,
                delay: star.delay,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}
          
          {/* Yellow twinkling stars */}
          {stars.slice(0, 20).map((star) => (
            <motion.div
              key={`yellow-${star.id}`}
              className="absolute rounded-full bg-yellow-300"
              style={{
                left: `${(star.x + 10) % 100}%`,
                top: `${(star.y + 15) % 100}%`,
                width: `${star.size * 0.8}px`,
                height: `${star.size * 0.8}px`,
              }}
              animate={{
                opacity: [0.2, 0.8, 0.2],
                scale: [0.8, 1.4, 0.8],
              }}
              transition={{
                duration: star.duration * 1.5,
                delay: star.delay + 1,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}

          {/* Shooting Stars */}
          <motion.div
            className="absolute w-1 h-1 bg-white rounded-full"
            animate={{
              x: [-100, window.innerWidth + 100],
              y: [100, 300],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: 2,
              delay: 0,
              repeat: Infinity,
              repeatDelay: 8,
              ease: "easeOut",
            }}
            style={{
              boxShadow: '0 0 10px white',
            }}
          />

          {/* Mouse-reactive nebula */}
          <motion.div
            className="absolute w-72 h-72 bg-purple-500/10 rounded-full blur-3xl"
            animate={{
              x: mousePosition.x * 3,
              y: mousePosition.y * 3,
            }}
            transition={{ type: "spring", stiffness: 30, damping: 40 }}
            style={{
              left: '30%',
              top: '40%',
            }}
          />
        </div>
      )}
    </div>
  );
};
