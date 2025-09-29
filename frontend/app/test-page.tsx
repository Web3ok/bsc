'use client';

import { Card, CardBody, CardHeader } from '@nextui-org/react';

export default function TestPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Card Test</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-4 shadow-md border">
          <CardHeader>
            <h3 className="text-sm font-medium">Test Card 1</h3>
          </CardHeader>
          <CardBody>
            <div className="text-2xl font-bold">Content 1</div>
            <p className="text-xs text-foreground/60">Description 1</p>
          </CardBody>
        </Card>
        
        <Card className="p-4 shadow-md border">
          <CardHeader>
            <h3 className="text-sm font-medium">Test Card 2</h3>
          </CardHeader>
          <CardBody>
            <div className="text-2xl font-bold">Content 2</div>
            <p className="text-xs text-foreground/60">Description 2</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}