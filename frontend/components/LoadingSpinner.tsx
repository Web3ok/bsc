'use client';

import React from 'react';
import { Spinner } from '@nextui-org/react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

export default function LoadingSpinner({ 
  size = 'md', 
  label = 'Loading...', 
  className = '' 
}: LoadingSpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
      <Spinner size={size} color="primary" />
      {label && (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          {label}
        </p>
      )}
    </div>
  );
}