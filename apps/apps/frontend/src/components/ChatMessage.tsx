import { motion } from 'framer-motion';
import { Users, Check, CheckCheck } from 'lucide-react';

interface Message {
  id: number;
  sender: {
    username: string;
    displayName: string;
  };
  content: string;
  timestamp: string;
  isRead: boolean;
  isOwn: boolean;
}

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage = ({ message }: ChatMessageProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex gap-2 sm:gap-3 ${message.isOwn ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0">
        <Users className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
      </div>

      {/* Message Content */}
      <div className={`max-w-[75%] sm:max-w-[70%] ${message.isOwn ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Sender Info */}
        <div className={`flex items-center gap-2 mb-1 ${message.isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className="text-xs sm:text-sm font-medium text-card-foreground">
            {message.isOwn ? 'You' : message.sender.displayName}
          </span>
          <span className="text-xs text-foreground-muted">{message.timestamp}</span>
        </div>

        {/* Message Bubble */}
        <div
          className={`
            px-3 py-2 sm:px-4 sm:py-2 rounded-2xl max-w-full break-words
            ${message.isOwn 
              ? 'bg-chat-bubble-own text-chat-text rounded-br-md' 
              : 'bg-chat-bubble text-chat-text rounded-bl-md'
            }
          `}
        >
          <p className="text-xs sm:text-sm leading-relaxed">{message.content}</p>
        </div>

        {/* Read Status (only for own messages) */}
        {message.isOwn && (
          <div className="flex items-center justify-end mt-1">
            {message.isRead ? (
              <CheckCheck className="h-3 w-3 text-primary" />
            ) : (
              <Check className="h-3 w-3 text-foreground-muted" />
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};