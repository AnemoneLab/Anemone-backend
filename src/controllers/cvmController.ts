import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { PhalaCloud } from '@anemonelab/phala-cloud-sdk';
import { 
  getAvailableCvm, 
  getAvailablePhalaAccount, 
  updatePhalaAccount,
  markCvmAsInUse,
  getCvmPoolStatus,
  getQuery,
  monitorDeployment,
  deployNewCvms
} from '../db/database';

// 生成唯一的CVM名称
const generateUniqueCvmName = (prefix: string = 'agent-cvm'): string => {
  // 使用时间戳和随机字符串生成唯一标识符
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${randomString}`;
};

/**
 * Deploy a new agent CVM container
 * @param req Request with name parameter
 * @param res Response
 */
export const deployAgentCvmHandler = async (req: Request, res: Response) => {
  try {
    // 获取可用的Phala账户
    const phalaAccount = await getAvailablePhalaAccount();
    
    if (!phalaAccount || !phalaAccount.api_key) {
      return res.status(503).json({
        success: false,
        message: '没有可用的Phala账户，请先配置账户',
      });
    }
    
    // 生成CVM名称
    const name = req.body.name || `agent-cvm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    // 使用SDK部署CVM
    try {
      const { PhalaCloud } = require('@anemonelab/phala-cloud-sdk');
      const path = require('path');
      const fs = require('fs');
      
      // 初始化SDK
      const phalaCloud = new PhalaCloud({
        apiKey: phalaAccount.api_key,
      });
      
      // 获取要使用的Docker Compose文件路径
      let composePath: string;
      
      // 如果请求中指定了版本号，则使用指定版本
      if (req.body.version) {
        const requestedVersion = req.body.version;
        composePath = path.resolve(__dirname, `../../src/docker-compose/agent-cvm-v${requestedVersion}.yml`);
        
        if (!fs.existsSync(composePath)) {
          return res.status(400).json({
            success: false,
            message: `指定的版本 ${requestedVersion} 不存在`
          });
        }
      } else {
        // 否则获取最新版本
        const composeDirPath = path.resolve(__dirname, '../../src/docker-compose');
        const files = fs.readdirSync(composeDirPath);
        
        // 过滤出agent-cvm的YAML文件并提取版本号
        const versionPattern = /agent-cvm-v(\d+\.\d+\.\d+)\.yml/;
        const versions = files
          .filter((file: string) => versionPattern.test(file))
          .map((file: string) => {
            const match = file.match(versionPattern);
            const version = match ? match[1] : '0.0.0';
            return {
              version,
              file,
              path: path.join(composeDirPath, file)
            };
          });
        
        // 按版本号降序排序（较新的版本在前）
        versions.sort((a: any, b: any) => {
          const aVersion = a.version.split('.').map(Number);
          const bVersion = b.version.split('.').map(Number);
          
          for (let i = 0; i < 3; i++) {
            if (aVersion[i] !== bVersion[i]) {
              return bVersion[i] - aVersion[i]; // 降序
            }
          }
          
          return 0;
        });
        
        // 使用最新版本
        if (versions.length === 0) {
          return res.status(500).json({
            success: false,
            message: '找不到可用的Docker Compose文件'
          });
        }
        
        composePath = versions[0].path;
        console.log(`使用最新版本的Docker Compose文件: ${versions[0].file}`);
      }
      
      if (!fs.existsSync(composePath)) {
        return res.status(500).json({
          success: false,
          message: 'Docker compose文件不存在',
        });
      }
      
      // 部署CVM
      const deployResult = await phalaCloud.deploy({
        type: 'phala',
        mode: 'docker-compose',
        name,
        compose: composePath,
        env: [
          'NODE_ENV=production',
          'PORT=3001',
        ],
      });
      
      // 更新账户状态
      await updatePhalaAccount(phalaAccount.id as number, {
        status: 'deploying',
        app_id: deployResult.app_id,
      });
      
      // 启动异步监控任务
      monitorDeployment(phalaAccount.id as number, deployResult.app_id, phalaAccount.api_key);
      
      return res.status(200).json({
        success: true,
        message: 'CVM部署已开始，后台处理中',
        cvm_id: deployResult.app_id,
      });
    } catch (error: any) {
      console.error('CVM部署失败:', error);
      return res.status(500).json({
        success: false,
        message: `CVM部署失败: ${error.message}`,
      });
    }
  } catch (error: any) {
    console.error('Error deploying CVM:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get an available CVM for agent creation
 * @param req Request
 * @param res Response
 */
export const getAvailableCvmHandler = async (req: Request, res: Response) => {
  try {
    // 获取可用的已部署CVM
    const cvm = await getAvailableCvm();
    
    if (!cvm || !cvm.app_id || !cvm.cvm_endpoint) {
      // 如果没有可用的已部署CVM，尝试部署一个新的
      return res.status(404).json({
        success: false,
        message: '没有可用的CVM',
      });
    }
    
    // 尝试获取钱包地址
    try {
      const endpoint = `${cvm.cvm_endpoint.replace(/\/+$/, '')}/wallet`;
      const response = await axios.get(endpoint);
      
      if (response.data && response.data.address) {
        // 标记CVM为使用中
        await markCvmAsInUse(cvm.id as number, response.data.address);
        
        return res.status(200).json({
          success: true,
          cvm_id: cvm.id,
          app_id: cvm.app_id,
          address: response.data.address,
          endpoint: cvm.cvm_endpoint
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'CVM wallet is not properly initialized'
        });
      }
    } catch (error) {
      console.error('Error fetching wallet address from CVM:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to connect to CVM wallet service'
      });
    }
  } catch (error: any) {
    console.error('Error getting available CVM:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get available CVM'
    });
  }
};

/**
 * Get current CVM pool status
 * @param req Request
 * @param res Response
 */
export const getCvmPoolStatusHandler = async (req: Request, res: Response) => {
  try {
    const status = await getCvmPoolStatus();
    
    return res.status(200).json({
      success: true,
      ...status
    });
  } catch (error: any) {
    console.error('Error getting CVM pool status:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get CVM pool status'
    });
  }
};

/**
 * Deploy CVMs to maintain pool size
 * @param req Request
 * @param res Response
 */
export const maintainCvmPoolHandler = async (req: Request, res: Response) => {
  try {
    const count = Math.min(parseInt(req.body.count) || 3, 10); // 默认部署3个，最多10个
    
    // 获取当前池状态
    const poolStatus = await getCvmPoolStatus();
    
    const pendingDeployments = poolStatus.deploying;
    
    if (pendingDeployments > 0) {
      return res.status(400).json({
        success: false,
        message: `当前有 ${pendingDeployments} 个CVM正在部署中，请等待部署完成后再试`,
      });
    }
    
    // 计算可部署的数量
    const availableCvmCount = poolStatus.deployed;
    const targetCvmCount = 10; // 目标CVM数量
    const remainingSlots = targetCvmCount - availableCvmCount;
    
    if (remainingSlots <= 0) {
      return res.status(400).json({
        success: false,
        message: `CVM池已有足够的CVM (${availableCvmCount}/${targetCvmCount})`,
      });
    }
    
    // 检查有多少有API Key的可用账户
    const availableAccounts = await getQuery(`
            SELECT COUNT(*) as count
            FROM phala_accounts
            WHERE status = 'ready' AND api_key IS NOT NULL AND app_id IS NULL
        `);
    
    const availableAccountCount = availableAccounts[0].count;
    
    if (availableAccountCount === 0) {
      return res.status(400).json({
        success: false,
        message: '没有可用的Phala账户（有API Key的ready状态账户）来部署CVM，请先添加账户或API Key',
      });
    }
    
    const canDeployCount = Math.min(availableAccountCount, count, remainingSlots);
    
    if (canDeployCount === 0) {
      return res.status(400).json({
        success: false,
        message: '无法部署更多CVM，请检查账户状态',
      });
    }
    
    // 部署CVM
    deployNewCvms(canDeployCount).catch((error: any) => {
      console.error('CVM部署过程中发生错误:', error);
    });
    
    return res.status(200).json({
      success: true,
      message: `已开始部署 ${canDeployCount} 个CVM，部署过程将在后台进行`,
    });
  } catch (error: any) {
    console.error('Error maintaining CVM pool:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * 获取CVM的证明信息
 * @param req Request - 包含appId参数
 * @param res Response
 */
export const getAttestationHandler = async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        message: '缺少应用ID参数'
      });
    }
    
    // 从数据库中获取与appId关联的账户
    const accounts = await getQuery(`
      SELECT * FROM phala_accounts 
      WHERE app_id = ? AND api_key IS NOT NULL
      LIMIT 1
    `, [appId]);
    
    if (accounts.length === 0) {
      return res.status(404).json({
        success: false,
        message: `未找到与应用ID ${appId} 关联的账户或API key`
      });
    }
    
    const account = accounts[0];
    
    // 创建PhalaCloud实例，使用找到的API key
    const phalaCloud = new PhalaCloud({
      apiKey: account.api_key
    });
    
    try {
      // 获取CVM证明信息
      const attestationData = await phalaCloud.getCvmAttestation(appId);

      console.log(attestationData);
      
      res.json({
        success: true,
        data: attestationData
      });
    } catch (error: any) {
      console.error(`获取应用 ${appId} 的证明信息失败:`, error);
      
      // 如果错误是因为CVM未部署或离线
      if (error.response && error.response.status === 404) {
        return res.status(404).json({
          success: false,
          message: `无法找到应用 ${appId} 的证明信息，可能CVM未部署或已离线`
        });
      }
      
      res.status(500).json({
        success: false,
        message: `获取证明信息失败: ${error.message}`
      });
    }
  } catch (error: any) {
    console.error('处理证明信息请求时出错:', error);
    res.status(500).json({
      success: false,
      message: `服务器错误: ${error.message}`
    });
  }
};

/**
 * 获取CVM的系统状态信息
 * @param req Request - 包含appId参数
 * @param res Response
 */
export const getCvmStatsHandler = async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        message: '缺少应用ID参数'
      });
    }
    
    // 从数据库中获取与appId关联的账户
    const accounts = await getQuery(`
      SELECT * FROM phala_accounts 
      WHERE app_id = ? AND api_key IS NOT NULL
      LIMIT 1
    `, [appId]);
    
    if (accounts.length === 0) {
      return res.status(404).json({
        success: false,
        message: `未找到与应用ID ${appId} 关联的账户或API key`
      });
    }
    
    const account = accounts[0];
    
    // 创建PhalaCloud实例，使用找到的API key
    const phalaCloud = new PhalaCloud({
      apiKey: account.api_key
    });
    
    try {
      // 获取CVM系统状态信息
      const statsData = await phalaCloud.getCvmStats(appId);
      
      res.json({
        success: true,
        data: statsData
      });
    } catch (error: any) {
      console.error(`获取应用 ${appId} 的系统状态信息失败:`, error);
      
      // 如果错误是因为CVM未部署或离线
      if (error.response && error.response.status === 404) {
        return res.status(404).json({
          success: false,
          message: `无法找到应用 ${appId} 的系统状态信息，可能CVM未部署或已离线`
        });
      }
      
      res.status(500).json({
        success: false,
        message: `获取系统状态信息失败: ${error.message}`
      });
    }
  } catch (error: any) {
    console.error('处理系统状态信息请求时出错:', error);
    res.status(500).json({
      success: false,
      message: `服务器错误: ${error.message}`
    });
  }
};

/**
 * 获取CVM的组合信息
 * @param req Request - 包含appId参数
 * @param res Response
 */
export const getCvmCompositionHandler = async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        message: '缺少应用ID参数'
      });
    }
    
    // 从数据库中获取与appId关联的账户
    const accounts = await getQuery(`
      SELECT * FROM phala_accounts 
      WHERE app_id = ? AND api_key IS NOT NULL
      LIMIT 1
    `, [appId]);
    
    if (accounts.length === 0) {
      return res.status(404).json({
        success: false,
        message: `未找到与应用ID ${appId} 关联的账户或API key`
      });
    }
    
    const account = accounts[0];
    
    // 创建PhalaCloud实例，使用找到的API key
    const phalaCloud = new PhalaCloud({
      apiKey: account.api_key
    });
    
    try {
      // 获取CVM组合信息
      const compositionData = await phalaCloud.getCvmComposition(appId);
      
      res.json({
        success: true,
        data: compositionData
      });
    } catch (error: any) {
      console.error(`获取应用 ${appId} 的组合信息失败:`, error);
      
      // 如果错误是因为CVM未部署或离线
      if (error.response && error.response.status === 404) {
        return res.status(404).json({
          success: false,
          message: `无法找到应用 ${appId} 的组合信息，可能CVM未部署或已离线`
        });
      }
      
      res.status(500).json({
        success: false,
        message: `获取组合信息失败: ${error.message}`
      });
    }
  } catch (error: any) {
    console.error('处理组合信息请求时出错:', error);
    res.status(500).json({
      success: false,
      message: `服务器错误: ${error.message}`
    });
  }
};

/**
 * 启动CVM
 * @param req Request - 包含appId参数
 * @param res Response
 */
export const startCvmHandler = async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        message: '缺少应用ID参数'
      });
    }
    
    // 从数据库中获取与appId关联的账户
    const accounts = await getQuery(`
      SELECT * FROM phala_accounts 
      WHERE app_id = ? AND api_key IS NOT NULL
      LIMIT 1
    `, [appId]);
    
    if (accounts.length === 0) {
      return res.status(404).json({
        success: false,
        message: `未找到与应用ID ${appId} 关联的账户或API key`
      });
    }
    
    const account = accounts[0];
    
    // 创建PhalaCloud实例，使用找到的API key
    const phalaCloud = new PhalaCloud({
      apiKey: account.api_key
    });
    
    try {
      // 启动CVM
      const startResult = await phalaCloud.startCvm(appId);
      
      // 更新数据库中的状态
      await getQuery(`
        UPDATE phala_accounts 
        SET status = ? 
        WHERE app_id = ?
      `, [startResult.status, appId]);
      
      res.json({
        success: true,
        message: `CVM ${appId} 正在启动`,
        data: startResult
      });
    } catch (error: any) {
      console.error(`启动应用 ${appId} 失败:`, error);
      
      // 处理特定错误
      if (error.response) {
        if (error.response.status === 404) {
          return res.status(404).json({
            success: false,
            message: `未找到应用 ${appId}`
          });
        } else if (error.response.status === 409) {
          return res.status(409).json({
            success: false,
            message: `应用 ${appId} 已经在运行或处于不允许启动的状态`
          });
        }
      }
      
      res.status(500).json({
        success: false,
        message: `启动CVM失败: ${error.message}`
      });
    }
  } catch (error: any) {
    console.error('处理启动CVM请求时出错:', error);
    res.status(500).json({
      success: false,
      message: `服务器错误: ${error.message}`
    });
  }
};

/**
 * 停止CVM
 * @param req Request - 包含appId参数
 * @param res Response
 */
export const stopCvmHandler = async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        message: '缺少应用ID参数'
      });
    }
    
    // 从数据库中获取与appId关联的账户
    const accounts = await getQuery(`
      SELECT * FROM phala_accounts 
      WHERE app_id = ? AND api_key IS NOT NULL
      LIMIT 1
    `, [appId]);
    
    if (accounts.length === 0) {
      return res.status(404).json({
        success: false,
        message: `未找到与应用ID ${appId} 关联的账户或API key`
      });
    }
    
    const account = accounts[0];
    
    // 创建PhalaCloud实例，使用找到的API key
    const phalaCloud = new PhalaCloud({
      apiKey: account.api_key
    });
    
    try {
      // 停止CVM
      const stopResult = await phalaCloud.stopCvm(appId);
      
      // 更新数据库中的状态
      await getQuery(`
        UPDATE phala_accounts 
        SET status = ? 
        WHERE app_id = ?
      `, [stopResult.status, appId]);
      
      res.json({
        success: true,
        message: `CVM ${appId} 已停止`,
        data: stopResult
      });
    } catch (error: any) {
      console.error(`停止应用 ${appId} 失败:`, error);
      
      // 处理特定错误
      if (error.response) {
        if (error.response.status === 404) {
          return res.status(404).json({
            success: false,
            message: `未找到应用 ${appId}`
          });
        } else if (error.response.status === 409) {
          return res.status(409).json({
            success: false,
            message: `应用 ${appId} 已经停止或处于不允许停止的状态`
          });
        }
      }
      
      res.status(500).json({
        success: false,
        message: `停止CVM失败: ${error.message}`
      });
    }
  } catch (error: any) {
    console.error('处理停止CVM请求时出错:', error);
    res.status(500).json({
      success: false,
      message: `服务器错误: ${error.message}`
    });
  }
};

/**
 * 获取所有可用的CVM版本
 * @param req Request
 * @param res Response
 */
export const getCvmVersionsHandler = async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // 获取docker-compose目录路径
    const composeDirPath = path.resolve(__dirname, '../../src/docker-compose');
    
    // 读取目录中的所有文件
    const files = fs.readdirSync(composeDirPath);
    
    // 过滤出agent-cvm的YAML文件并提取版本号
    const versionPattern = /agent-cvm-v(\d+\.\d+\.\d+)\.yml/;
    const versions = files
      .filter(file => versionPattern.test(file))
      .map(file => {
        const match = file.match(versionPattern);
        const version = match ? match[1] : '0.0.0';
        return {
          version,
          file,
          path: path.join(composeDirPath, file)
        };
      });
    
    // 按版本号降序排序（较新的版本在前）
    versions.sort((a, b) => {
      const aVersion = a.version.split('.').map(Number);
      const bVersion = b.version.split('.').map(Number);
      
      for (let i = 0; i < 3; i++) {
        if (aVersion[i] !== bVersion[i]) {
          return bVersion[i] - aVersion[i]; // 降序
        }
      }
      
      return 0;
    });
    
    const latestVersion = versions.length > 0 ? versions[0] : null;
    
    res.json({
      success: true,
      versions: versions.map(v => ({ version: v.version, file: v.file })),
      latest: latestVersion ? { version: latestVersion.version, file: latestVersion.file } : null
    });
  } catch (error: any) {
    console.error('获取CVM版本列表出错:', error);
    res.status(500).json({
      success: false,
      message: `获取CVM版本列表失败: ${error.message}`
    });
  }
};

/**
 * 更新CVM的Docker Compose配置
 * @param req Request - 包含appId参数和version参数
 * @param res Response
 */
export const updateCvmComposeHandler = async (req: Request, res: Response) => {
  try {
    const { appId } = req.params;
    const { version } = req.body;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        message: '缺少应用ID参数'
      });
    }
    
    if (!version) {
      return res.status(400).json({
        success: false,
        message: '缺少版本参数'
      });
    }
    
    // 从数据库中获取与appId关联的账户
    const accounts = await getQuery(`
      SELECT * FROM phala_accounts 
      WHERE app_id = ? AND api_key IS NOT NULL
      LIMIT 1
    `, [appId]);
    
    if (accounts.length === 0) {
      return res.status(404).json({
        success: false,
        message: `未找到与应用ID ${appId} 关联的账户或API key`
      });
    }
    
    const account = accounts[0];
    
    // 查找指定版本的Docker Compose文件
    const fs = require('fs');
    const path = require('path');
    
    const composePath = path.resolve(__dirname, `../../src/docker-compose/agent-cvm-v${version}.yml`);
    
    if (!fs.existsSync(composePath)) {
      return res.status(404).json({
        success: false,
        message: `找不到版本 ${version} 的Docker Compose文件`
      });
    }
    
    // 创建PhalaCloud实例，使用找到的API key
    const phalaCloud = new PhalaCloud({
      apiKey: account.api_key
    });
    
    try {
      // 更新CVM的Docker Compose配置
      const updateResult = await phalaCloud.updateCompose({
        identifier: appId,
        compose: composePath,
        allowRestart: true
      });
      
      res.json({
        success: true,
        message: `CVM ${appId} 的Docker Compose配置已更新为版本 ${version}`,
        data: updateResult
      });
    } catch (error: any) {
      console.error(`更新应用 ${appId} 的Docker Compose配置失败:`, error);
      
      // 处理特定错误
      if (error.response) {
        if (error.response.status === 404) {
          return res.status(404).json({
            success: false,
            message: `未找到应用 ${appId}`
          });
        } else if (error.response.status === 409) {
          return res.status(409).json({
            success: false,
            message: `应用 ${appId} 状态冲突，无法更新配置`
          });
        }
      }
      
      res.status(500).json({
        success: false,
        message: `更新Docker Compose配置失败: ${error.message}`
      });
    }
  } catch (error: any) {
    console.error('处理更新Docker Compose配置请求时出错:', error);
    res.status(500).json({
      success: false,
      message: `服务器错误: ${error.message}`
    });
  }
}; 