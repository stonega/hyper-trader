import { Card } from "heroui-native/card";
import type { JSX, ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <Card variant="secondary" className="gap-4">
      <Card.Body className="gap-3">
        <Card.Title>{title}</Card.Title>
        <Card.Description>{description}</Card.Description>
        {children}
      </Card.Body>
    </Card>
  );
}
