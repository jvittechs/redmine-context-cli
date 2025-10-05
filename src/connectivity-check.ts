import type { RedmineConfig } from './config.js';
import { RedmineApiClient, RedmineApiError } from './api.js';

export interface ConnectivityResult {
  success: boolean;
  message: string;
  details?: {
    baseUrl: string;
    project?: {
      id: number;
      identifier: string;
      name: string;
    };
  };
}

export async function checkConnectivity(config: RedmineConfig): Promise<ConnectivityResult> {
  const client = new RedmineApiClient(config);

  try {
    const isConnected = await client.checkConnectivity();

    if (!isConnected) {
      return {
        success: false,
        message: 'Failed to connect to Redmine API',
        details: {
          baseUrl: config.baseUrl,
        },
      };
    }

    const projectResponse = await client.getProject(config.project.identifier);

    return {
      success: true,
      message: `Successfully connected to Redmine and found project "${projectResponse.project.name}"`,
      details: {
        baseUrl: config.baseUrl,
        project: projectResponse.project,
      },
    };
  } catch (error) {
    if (error instanceof RedmineApiError) {
      let message = `Redmine API error: ${error.message}`;

      if (error.status === 401) {
        message = 'Authentication failed - please check your API access token';
      } else if (error.status === 403) {
        message = 'Access forbidden - insufficient permissions for the project';
      } else if (error.status === 404) {
        message = `Project "${config.project.identifier}" not found or inaccessible`;
      }

      return {
        success: false,
        message,
        details: {
          baseUrl: config.baseUrl,
        },
      };
    }

    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      details: {
        baseUrl: config.baseUrl,
      },
    };
  }
}
