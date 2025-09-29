'use client';

import { Avatar, Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@nextui-org/react';
import { useAuth } from '@/contexts/AuthContext';
import { useWebSocket } from '@/contexts/WebSocketContext';

export function Header() {
  const { user, logout } = useAuth();
  const { connected } = useWebSocket();

  const handleLogout = () => {
    logout();
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-card border-b border-border">
      <div className="flex items-center space-x-4">
        <h1 className="text-2xl font-bold text-foreground">BSC Trading Bot</h1>
        <div className={`flex items-center space-x-2 px-3 py-1 rounded-full ${
          connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm font-medium">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {user ? (
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <Avatar
                isBordered
                as="button"
                className="transition-transform"
                color="secondary"
                name={user.username}
                size="sm"
                src={user.avatar}
              />
            </DropdownTrigger>
            <DropdownMenu aria-label="Profile Actions" variant="flat">
              <DropdownItem key="profile" className="h-14 gap-2" textValue={`Signed in as ${user.username}`}>
                <p className="font-semibold">Signed in as</p>
                <p className="font-semibold">{user.username}</p>
              </DropdownItem>
              <DropdownItem key="settings" textValue="Settings">Settings</DropdownItem>
              <DropdownItem key="help" textValue="Help & Feedback">Help & Feedback</DropdownItem>
              <DropdownItem key="logout" color="danger" onPress={handleLogout} textValue="Log Out">
                Log Out
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        ) : (
          <Button color="primary" variant="solid">
            Login
          </Button>
        )}
      </div>
    </header>
  );
}