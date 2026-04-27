import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs/promises';
import * as path from 'path';
// Removed mime-types dependency to avoid Lambda bundling issues
import { S3UploadConfig } from '../types';

/**
 * S3 Upload Service
 * Handles uploading build artifacts to S3 with proper content types and caching headers
 */
export class S3UploadService {
  private s3: S3Client;
  private readonly defaultConfig: Partial<S3UploadConfig> = {
    serverSideEncryption: 'AES256',
    storageClass: 'STANDARD'
  };

  constructor(region?: string) {
    this.s3 = new S3Client({
      region: region || process.env.AWS_REGION
    });
  }

  /**
   * Upload build artifacts to S3 bucket
   */
  async uploadBuildArtifacts(
    buildPath: string, 
    config: S3UploadConfig,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    this.validateUploadConfig(config);
    
    const startTime = Date.now();
    const files = await this.getAllFiles(buildPath);
    
    if (files.length === 0) {
      throw new Error(`No files found in build path: ${buildPath}`);
    }

    const uploadResults: FileUploadResult[] = [];
    let uploadedFiles = 0;
    let uploadedBytes = 0;
    let totalBytes = 0;

    // Calculate total size
    for (const file of files) {
      const stats = await fs.stat(file);
      totalBytes += stats.size;
    }

    console.log(`Starting upload of ${files.length} files (${this.formatBytes(totalBytes)}) to s3://${config.bucketName}`);

    // Upload files with progress tracking
    for (const file of files) {
      try {
        const result = await this.uploadSingleFile(file, buildPath, config);
        uploadResults.push(result);
        
        uploadedFiles++;
        uploadedBytes += result.size;

        // Report progress
        if (onProgress) {
          onProgress({
            uploadedFiles,
            totalFiles: files.length,
            uploadedBytes,
            totalBytes,
            percentage: Math.round((uploadedBytes / totalBytes) * 100),
            currentFile: result.key,
            completedFiles: uploadResults.map(r => r.key)
          });
        }

        console.log(`Uploaded ${uploadedFiles}/${files.length}: ${result.key} (${this.formatBytes(result.size)})`);
      } catch (error) {
        console.error(`Failed to upload ${file}:`, error);
        throw new Error(`Upload failed for ${file}: ${error.message}`);
      }
    }

    const uploadTime = Date.now() - startTime;
    const result: UploadResult = {
      success: true,
      bucketName: config.bucketName,
      prefix: config.prefix || '',
      uploadedFiles: uploadResults,
      totalFiles: files.length,
      totalBytes: uploadedBytes,
      uploadTime,
      averageSpeed: uploadedBytes / (uploadTime / 1000) // bytes per second
    };

    console.log(`Upload completed: ${files.length} files (${this.formatBytes(uploadedBytes)}) in ${uploadTime}ms`);
    console.log(`Average speed: ${this.formatBytes(result.averageSpeed)}/s`);

    return result;
  }

  /**
   * Upload a single file to S3
   */
  private async uploadSingleFile(
    filePath: string, 
    buildPath: string, 
    config: S3UploadConfig
  ): Promise<FileUploadResult> {
    const relativePath = path.relative(buildPath, filePath);
    const key = config.prefix ? path.posix.join(config.prefix, relativePath) : relativePath;
    
    // Normalize path separators for S3 (always use forward slashes)
    const s3Key = key.replace(/\\/g, '/');
    
    const fileStats = await fs.stat(filePath);
    const contentType = this.getContentType(filePath);
    const cacheControl = this.getCacheControl(filePath);
    
    const uploadParams: any = {
      Bucket: config.bucketName,
      Key: s3Key,
      Body: await fs.readFile(filePath),
      ContentType: contentType,
      CacheControl: cacheControl,
      ServerSideEncryption: config.serverSideEncryption,
      StorageClass: config.storageClass,
      Metadata: {
        'original-path': relativePath,
        'upload-timestamp': new Date().toISOString(),
        ...config.metadata
      }
    };

    // Add KMS key if specified
    if (config.serverSideEncryption === 'aws:kms' && config.kmsKeyId) {
      uploadParams.SSEKMSKeyId = config.kmsKeyId;
    }

    // Add content encoding if specified
    if (config.contentEncoding) {
      uploadParams.ContentEncoding = config.contentEncoding;
    }

    const upload = new Upload({
      client: this.s3,
      params: uploadParams
    });

    const result = await upload.done();
    
    return {
      key: s3Key,
      originalPath: filePath,
      relativePath,
      size: fileStats.size,
      contentType,
      cacheControl,
      etag: result.ETag,
      location: result.Location,
      uploadedAt: new Date().toISOString()
    };
  }

  /**
   * Get all files recursively from a directory
   */
  async getAllFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          // Skip common directories that shouldn't be uploaded
          if (this.shouldSkipDirectory(entry.name)) {
            continue;
          }
          
          const subFiles = await this.getAllFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          // Skip files that shouldn't be uploaded
          if (this.shouldSkipFile(entry.name)) {
            continue;
          }
          
          files.push(fullPath);
        }
      }
    } catch (error) {
      throw new Error(`Failed to read directory ${dirPath}: ${error.message}`);
    }
    
    return files.sort(); // Sort for consistent ordering
  }

  /**
   * Get MIME content type for file
   */
  getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    
    // Comprehensive MIME type mappings for common web files
    const customTypes: Record<string, string> = {
      // JavaScript and TypeScript
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.jsx': 'application/javascript',
      '.ts': 'application/javascript',
      '.tsx': 'application/javascript',
      
      // Stylesheets
      '.css': 'text/css',
      '.scss': 'text/css',
      '.sass': 'text/css',
      '.less': 'text/css',
      
      // HTML
      '.html': 'text/html',
      '.htm': 'text/html',
      
      // Data formats
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.csv': 'text/csv',
      
      // Images
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.ico': 'image/x-icon',
      
      // Fonts
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.eot': 'application/vnd.ms-fontobject',
      
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      
      // Audio
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      
      // Documents
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      
      // Text
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.rtf': 'application/rtf',
      
      // Archives
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.rar': 'application/vnd.rar',
      '.7z': 'application/x-7z-compressed',
      
      // Web manifests and configs
      '.webmanifest': 'application/manifest+json',
      '.map': 'application/json', // Source maps
      '.wasm': 'application/wasm'
    };

    if (customTypes[ext]) {
      return customTypes[ext];
    }

    // Default fallback
    return 'application/octet-stream';
  }

  /**
   * Get cache control header for file
   */
  getCacheControl(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath).toLowerCase();
    
    // No cache for HTML files (for SPA routing)
    if (ext === '.html' || fileName === 'index.html') {
      return 'public, max-age=0, must-revalidate';
    }
    
    // Short cache for service worker and manifest files
    if (fileName.includes('service-worker') || fileName.includes('sw.') || ext === '.webmanifest') {
      return 'public, max-age=300'; // 5 minutes
    }
    
    // Long cache for static assets with hash in filename
    if (this.hasHashInFilename(fileName)) {
      return 'public, max-age=31536000, immutable'; // 1 year
    }
    
    // Medium cache for other static assets
    if (['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
      return 'public, max-age=86400'; // 1 day
    }
    
    // Short cache for API-like files
    if (['.json', '.xml'].includes(ext)) {
      return 'public, max-age=3600'; // 1 hour
    }
    
    // Default cache
    return 'public, max-age=3600'; // 1 hour
  }

  /**
   * Check if filename contains a hash (for cache busting)
   */
  private hasHashInFilename(fileName: string): boolean {
    // Common patterns for hashed filenames
    const hashPatterns = [
      /\.[a-f0-9]{8,}\./i,  // .12345678.
      /\.[a-f0-9]{20,}\./i, // .long-hash.
      /-[a-f0-9]{8,}\./i,   // -12345678.
      /\.[a-f0-9]{8,}$/i    // .12345678 (at end)
    ];
    
    return hashPatterns.some(pattern => pattern.test(fileName));
  }

  /**
   * Check if directory should be skipped
   */
  private shouldSkipDirectory(dirName: string): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      '.svn',
      '.hg',
      'coverage',
      '.nyc_output',
      'dist',
      'build',
      '.cache',
      '.temp',
      '.tmp',
      '__pycache__',
      '.pytest_cache',
      '.DS_Store'
    ];
    
    return skipDirs.includes(dirName) || dirName.startsWith('.');
  }

  /**
   * Check if file should be skipped
   */
  private shouldSkipFile(fileName: string): boolean {
    const skipFiles = [
      '.DS_Store',
      'Thumbs.db',
      '.gitignore',
      '.gitkeep',
      '.npmignore',
      'npm-debug.log',
      'yarn-error.log',
      '.env',
      '.env.local',
      '.env.development',
      '.env.staging',
      '.env.production'
    ];
    
    const skipExtensions = [
      '.log',
      '.tmp',
      '.temp',
      '.bak',
      '.backup',
      '.swp',
      '.swo'
    ];
    
    const ext = path.extname(fileName).toLowerCase();
    
    return skipFiles.includes(fileName) || 
           skipExtensions.includes(ext) ||
           fileName.startsWith('.') ||
           fileName.endsWith('~');
  }

  /**
   * Validate upload configuration
   */
  private validateUploadConfig(config: S3UploadConfig): void {
    if (!config.bucketName || typeof config.bucketName !== 'string') {
      throw new Error('Bucket name is required and must be a string');
    }
    
    if (!/^[a-z0-9.-]{3,63}$/.test(config.bucketName)) {
      throw new Error('Invalid bucket name format');
    }
    
    if (config.prefix && typeof config.prefix !== 'string') {
      throw new Error('Prefix must be a string');
    }
    
    if (config.kmsKeyId && config.serverSideEncryption !== 'aws:kms') {
      throw new Error('KMS key ID can only be used with aws:kms encryption');
    }
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Check if S3 bucket exists and is accessible
   */
  async validateBucket(bucketName: string): Promise<boolean> {
    try {
      const command = new HeadBucketCommand({ Bucket: bucketName });
      await this.s3.send(command);
      return true;
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw new Error(`Failed to validate bucket ${bucketName}: ${error.message}`);
    }
  }

  /**
   * Create S3 bucket if it doesn't exist
   */
  async createBucketIfNotExists(bucketName: string, region?: string): Promise<void> {
    const exists = await this.validateBucket(bucketName);
    
    if (!exists) {
      const createParams: any = {
        Bucket: bucketName
      };
      
      // Add location constraint for regions other than us-east-1
      const bucketRegion = region || process.env.AWS_REGION!;
      if (bucketRegion !== 'us-east-1') {
        createParams.CreateBucketConfiguration = {
          LocationConstraint: bucketRegion
        };
      }
      
      const command = new CreateBucketCommand(createParams);
      await this.s3.send(command);
      console.log(`Created S3 bucket: ${bucketName}`);
    }
  }

  /**
   * Delete all objects in S3 bucket (for cleanup)
   */
  async clearBucket(bucketName: string, prefix?: string): Promise<void> {
    const listParams: any = {
      Bucket: bucketName,
      Prefix: prefix
    };
    
    let continuationToken: string | undefined;
    let deletedCount = 0;
    
    do {
      if (continuationToken) {
        listParams.ContinuationToken = continuationToken;
      }
      
      const listCommand = new ListObjectsV2Command(listParams);
      const listResult = await this.s3.send(listCommand);
      
      if (listResult.Contents && listResult.Contents.length > 0) {
        const deleteParams = {
          Bucket: bucketName,
          Delete: {
            Objects: listResult.Contents.map(obj => ({ Key: obj.Key! }))
          }
        };
        
        const deleteCommand = new DeleteObjectsCommand(deleteParams);
        const deleteResult = await this.s3.send(deleteCommand);
        deletedCount += deleteResult.Deleted?.length || 0;
        
        if (deleteResult.Errors && deleteResult.Errors.length > 0) {
          console.warn('Some objects failed to delete:', deleteResult.Errors);
        }
      }
      
      continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);
    
    console.log(`Deleted ${deletedCount} objects from s3://${bucketName}${prefix ? `/${prefix}` : ''}`);
  }
}

// Types for upload progress and results
export interface UploadProgress {
  uploadedFiles: number;
  totalFiles: number;
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
  currentFile: string;
  completedFiles: string[];
}

export interface FileUploadResult {
  key: string;
  originalPath: string;
  relativePath: string;
  size: number;
  contentType: string;
  cacheControl: string;
  etag: string;
  location: string;
  uploadedAt: string;
}

export interface UploadResult {
  success: boolean;
  bucketName: string;
  prefix: string;
  uploadedFiles: FileUploadResult[];
  totalFiles: number;
  totalBytes: number;
  uploadTime: number; // milliseconds
  averageSpeed: number; // bytes per second
}