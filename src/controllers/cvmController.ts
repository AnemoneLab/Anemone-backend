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
      
      // 找到docker-compose文件
      const composePath = path.resolve(__dirname, '../../src/docker-compose/agent-cvm.yml');
      
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