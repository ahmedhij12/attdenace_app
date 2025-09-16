import React from 'react';

interface AttendanceIconProps {
  size?: number;
  className?: string;
}

export const AttendanceIcon: React.FC<AttendanceIconProps> = ({ 
  size = 24, 
  className = "" 
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Clipboard background */}
      <rect
        x="4"
        y="2"
        width="16"
        height="20"
        rx="2"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      
      {/* Clipboard clip */}
      <rect
        x="8"
        y="1"
        width="8"
        height="3"
        rx="1"
        fill="currentColor"
        fillOpacity="0.2"
        stroke="currentColor"
        strokeWidth="1"
      />
      
      {/* Checkmarks */}
      <path
        d="M7 9L9 11L13 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      <path
        d="M7 13L9 15L13 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Lines representing text */}
      <line
        x1="15"
        y1="9"
        x2="17"
        y2="9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      
      <line
        x1="15"
        y1="13"
        x2="17"
        y2="13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      
      {/* Clock indicator */}
      <circle
        cx="16"
        cy="18"
        r="3"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      
      <path
        d="M16 16.5V18L17 18.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
};

export default AttendanceIcon;