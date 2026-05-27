import axios from 'axios';
import { apiService } from './api';

export interface LayerMetadata {
  id: string;
  name: string;
  description: string;
  compatibleRuntimes: string[];
  compatibleArchitectures: string[];
  layerVersionArn: string;
  version: number;
  sizeBytes?: number;
  createdAt: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  layerId: string;
  contentType: string;
}

export interface CreateLayerRequest {
  layerId: string;
  name: string;
  description?: string;
  compatibleRuntimes: string[];
  compatibleArchitectures: string[];
  s3Key: string;
}

export interface LayerInUseError {
  error: string;
  deployedWorkflows?: Array<{ id: string; name: string }>;
  totalReferences?: number;
}

class LayerApiService {
  async listLayers(): Promise<LayerMetadata[]> {
    const response = await apiService.get<{ layers: LayerMetadata[] }>('/layers');
    return response.layers;
  }

  async getUploadUrl(name: string): Promise<UploadUrlResponse> {
    return await apiService.post<UploadUrlResponse>('/layers/upload-url', { name });
  }

  /**
   * Upload the zip directly to S3 using the presigned PUT URL.
   * The Content-Type header MUST match the type the URL was signed with
   * (application/zip), otherwise S3 rejects the request.
   */
  async uploadFile(uploadUrl: string, file: File, contentType: string): Promise<void> {
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': contentType },
      transformRequest: [(data) => data],
    });
  }

  async createLayer(request: CreateLayerRequest): Promise<LayerMetadata> {
    const response = await apiService.post<{ layer: LayerMetadata }>('/layers', request);
    return response.layer;
  }

  async deleteLayer(layerId: string, force = false): Promise<void> {
    const path = force ? `/layers/${layerId}?force=true` : `/layers/${layerId}`;
    await apiService.delete(path);
  }
}

export const layerApiService = new LayerApiService();
