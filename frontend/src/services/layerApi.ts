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

class LayerApiService {
  async listLayers(): Promise<LayerMetadata[]> {
    const response = await apiService.get<{ layers: LayerMetadata[] }>('/layers');
    return response.layers;
  }

  async getUploadUrl(name: string, contentType = 'application/zip'): Promise<UploadUrlResponse> {
    return await apiService.post<UploadUrlResponse>('/layers/upload-url', { name, contentType });
  }

  async uploadFile(uploadUrl: string, file: File, contentType = 'application/zip'): Promise<void> {
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': contentType },
      transformRequest: [(data) => data],
    });
  }

  async createLayer(request: CreateLayerRequest): Promise<LayerMetadata> {
    const response = await apiService.post<{ layer: LayerMetadata }>('/layers', request);
    return response.layer;
  }

  async deleteLayer(layerId: string): Promise<void> {
    await apiService.delete(`/layers/${layerId}`);
  }
}

export const layerApiService = new LayerApiService();
