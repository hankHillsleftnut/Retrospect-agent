import type { IntegrationSourceItemInput } from '../types';

export interface ConnectorContext {
  userId: string;
  connectionId: string;
  providerId: string;
  cursor: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface ConnectorResult {
  cursorAfter: Record<string, unknown>;
  items: IntegrationSourceItemInput[];
  deletedProviderObjectIds?: string[];
}

export interface IntegrationConnector {
  providerId: string;
  sync(context: ConnectorContext): Promise<ConnectorResult>;
}

const connectors = new Map<string, IntegrationConnector>();

export function registerConnector(connector: IntegrationConnector): void {
  connectors.set(connector.providerId, connector);
}

export function getConnector(providerId: string): IntegrationConnector {
  const connector = connectors.get(providerId);
  if (!connector) {
    throw new Error(`No continuous connector is registered for ${providerId}`);
  }
  return connector;
}

export function registeredConnectorIds(): string[] {
  return [...connectors.keys()].sort();
}
