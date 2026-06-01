import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { toast } from 'sonner';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { 
  Plus, 
  Trash2, 
  Edit3, 
  Cpu, 
  Server, 
  Settings, 
  Save, 
  X,
  Gauge
} from 'lucide-react';

interface SutManagerProps {
  trigger?: React.ReactNode;
  onSelect?: (envId: number) => void;
  selectedId?: number;
}

const GPU_MODELS = [
  "NVIDIA H100",
  "NVIDIA A100-SXM4-80GB",
  "NVIDIA A100-PCIE-40GB",
  "NVIDIA A800",
  "NVIDIA L40S",
  "NVIDIA RTX 4090",
  "NVIDIA RTX 3090",
  "Apple M2 Ultra",
  "CPU Only",
  "Custom"
];

const INFERENCE_ENGINES = [
  "vLLM",
  "TensorRT-LLM",
  "TGI (Text Generation Inference)",
  "Ollama",
  "LMDeploy",
  "Triton Inference Server",
  "HuggingFace Transformers",
  "Custom"
];

const QUANTIZATIONS = [
  "None (FP16/BF16)",
  "FP8 (e4m3 / e5m2)",
  "AWQ (INT4)",
  "GPTQ (INT4)",
  "GGUF",
  "Custom"
];

export default function SutManager({ trigger, onSelect, selectedId }: SutManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingEnv, setEditingEnv] = useState<any | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Form State (using strings for inputs to prevent browser number spinner controls and support clean typing validation)
  const [formData, setFormData] = useState({
    name: '',
    gpuModel: 'NVIDIA A100-SXM4-80GB',
    gpuCount: '1',
    inferenceEngine: 'vLLM',
    engineVersion: '',
    quantization: 'None (FP16/BF16)',
    maxModelLen: '4096',
    gpuMemoryUtilization: '0.90',
    prometheusUrl: '',
  });

  const { data: environments = [], refetch } = trpc.environment.getEnvironments.useQuery();
  const createEnv = trpc.environment.createEnvironment.useMutation();
  const updateEnv = trpc.environment.updateEnvironment.useMutation();
  const deleteEnv = trpc.environment.deleteEnvironment.useMutation();

  const handleOpenForm = (env?: any) => {
    if (env) {
      setEditingEnv(env);
      setFormData({
        name: env.name,
        gpuModel: env.gpuModel || 'NVIDIA A100-SXM4-80GB',
        gpuCount: env.gpuCount !== null && env.gpuCount !== undefined ? env.gpuCount.toString() : '1',
        inferenceEngine: env.inferenceEngine || 'vLLM',
        engineVersion: env.engineVersion || '',
        quantization: env.quantization || 'None (FP16/BF16)',
        maxModelLen: env.maxModelLen !== null && env.maxModelLen !== undefined ? env.maxModelLen.toString() : '4096',
        gpuMemoryUtilization: env.gpuMemoryUtilization !== null && env.gpuMemoryUtilization !== undefined ? env.gpuMemoryUtilization.toString() : '0.90',
        prometheusUrl: env.prometheusUrl || '',
      });
    } else {
      setEditingEnv(null);
      setFormData({
        name: '',
        gpuModel: 'NVIDIA A100-SXM4-80GB',
        gpuCount: '1',
        inferenceEngine: 'vLLM',
        engineVersion: '',
        quantization: 'None (FP16/BF16)',
        maxModelLen: '4096',
        gpuMemoryUtilization: '0.90',
        prometheusUrl: '',
      });
    }
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('请输入环境名称');
      return;
    }

    try {
      const parsedData = {
        name: formData.name,
        gpuModel: formData.gpuModel,
        gpuCount: formData.gpuCount ? parseInt(formData.gpuCount, 10) : 0,
        inferenceEngine: formData.inferenceEngine,
        engineVersion: formData.engineVersion,
        quantization: formData.quantization,
        maxModelLen: formData.maxModelLen ? parseInt(formData.maxModelLen, 10) : 4096,
        gpuMemoryUtilization: formData.gpuMemoryUtilization ? parseFloat(formData.gpuMemoryUtilization) : 0.90,
        prometheusUrl: formData.prometheusUrl,
      };

      if (editingEnv) {
        await updateEnv.mutateAsync({
          id: editingEnv.id,
          data: parsedData
        });
        toast.success('被测环境更新成功');
      } else {
        const res = await createEnv.mutateAsync(parsedData);
        toast.success('被测环境创建成功');
        if (onSelect && res.id) {
          onSelect(res.id);
        }
      }
      setIsFormOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message || '保存失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除该被测环境吗？')) return;
    try {
      await deleteEnv.mutateAsync({ id });
      toast.success('删除成功');
      refetch();
    } catch (err: any) {
      toast.error(err.message || '删除失败');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || <Button variant="outline">管理被测环境</Button>}
      </DialogTrigger>

      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold">
            <Server className="w-6 h-6 text-primary" />
            被测环境 (SUT) 管理
          </DialogTitle>
        </DialogHeader>

        {isFormOpen ? (
          <form onSubmit={handleSave} className="space-y-6 py-4">
            <h3 className="text-lg font-bold border-b pb-2 flex items-center gap-2">
              <Settings className="w-5 h-5 text-primary" />
              {editingEnv ? '修改环境配置' : '添加被测环境'}
            </h3>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="env-name">环境别名 *</Label>
                <Input
                  id="env-name"
                  placeholder="例如: vLLM-H100-FP8-Prod"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="env-gpuModel">GPU 型号</Label>
                <Select
                  value={formData.gpuModel}
                  onValueChange={(val) => setFormData({ ...formData, gpuModel: val })}
                >
                  <SelectTrigger id="env-gpuModel">
                    <SelectValue placeholder="选择GPU型号" />
                  </SelectTrigger>
                  <SelectContent>
                    {GPU_MODELS.map((model) => (
                      <SelectItem key={model} value={model}>{model}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="env-gpuCount">GPU 数量 (张/卡)</Label>
                <Input
                  id="env-gpuCount"
                  placeholder="例如: 1"
                  value={formData.gpuCount}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^\d+$/.test(val)) {
                      setFormData({ ...formData, gpuCount: val });
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="env-engine">推理引擎</Label>
                <Select
                  value={formData.inferenceEngine}
                  onValueChange={(val) => setFormData({ ...formData, inferenceEngine: val })}
                >
                  <SelectTrigger id="env-engine">
                    <SelectValue placeholder="选择推理引擎" />
                  </SelectTrigger>
                  <SelectContent>
                    {INFERENCE_ENGINES.map((eng) => (
                      <SelectItem key={eng} value={eng}>{eng}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="env-engineVersion">引擎版本</Label>
                <Input
                  id="env-engineVersion"
                  placeholder="例如: v0.4.2"
                  value={formData.engineVersion}
                  onChange={(e) => setFormData({ ...formData, engineVersion: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="env-quant">模型量化格式</Label>
                <Select
                  value={formData.quantization}
                  onValueChange={(val) => setFormData({ ...formData, quantization: val })}
                >
                  <SelectTrigger id="env-quant">
                    <SelectValue placeholder="选择量化格式" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUANTIZATIONS.map((q) => (
                      <SelectItem key={q} value={q}>{q}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="env-maxLen">最大模型上下文 (Context Len)</Label>
                <Input
                  id="env-maxLen"
                  placeholder="例如: 32768"
                  value={formData.maxModelLen}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^\d+$/.test(val)) {
                      setFormData({ ...formData, maxModelLen: val });
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="env-mem">GPU 显存最大使用率 (KV Cache比例)</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="env-mem"
                    className="w-24"
                    placeholder="例如: 0.90"
                    value={formData.gpuMemoryUtilization}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || /^\d*\.?\d*$/.test(val)) {
                        setFormData({ ...formData, gpuMemoryUtilization: val });
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground">推荐值: 0.85 - 0.95</span>
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="env-prom">Prometheus 监控服务 URL (可选)</Label>
                <Input
                  id="env-prom"
                  placeholder="例如: http://prometheus-host:9090 (用于自动拉取GPU/VRAM时序监控数据)"
                  value={formData.prometheusUrl}
                  onChange={(e) => setFormData({ ...formData, prometheusUrl: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" className="flex items-center gap-1">
                <Save className="w-4 h-4" />
                保存
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-6 py-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                管理已登记的被测大模型环境。关联环境后，测试报告将支持并排呈现 GPU 和 KV Cache 监控。
              </p>
              <Button onClick={() => handleOpenForm()} className="flex items-center gap-1">
                <Plus className="w-4 h-4" />
                登记新环境
              </Button>
            </div>

            {environments.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed rounded-xl border-border/60">
                <Server className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                <h4 className="font-bold text-foreground/75">暂无已注册环境</h4>
                <p className="text-sm text-muted-foreground mt-1 mb-4">创建环境画像来支持服务端指标监控。</p>
                <Button variant="outline" onClick={() => handleOpenForm()}>
                  立即创建
                </Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4 max-h-[50vh] overflow-y-auto">
                {environments.map((env: any) => (
                  <div 
                    key={env.id} 
                    className={`card-premium p-5 border flex flex-col justify-between transition-all ${
                      selectedId === env.id ? 'border-primary/80 ring-1 ring-primary/40' : 'border-border/60'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start gap-2 mb-3">
                        <h4 className="font-bold text-lg text-foreground line-clamp-1">{env.name}</h4>
                        {selectedId === env.id && (
                          <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-primary/10 text-primary">
                            当前选择
                          </span>
                        )}
                      </div>
                      
                      <div className="space-y-1.5 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-primary/80" />
                          <span>
                            {env.gpuCount ? `${env.gpuCount}x ` : ''}
                            {env.gpuModel || '未配置GPU'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Gauge className="w-4 h-4 text-primary/80" />
                          <span>{env.inferenceEngine || '未知引擎'} {env.engineVersion ? `@${env.engineVersion}` : ''}</span>
                        </div>
                        {env.quantization && (
                          <div className="text-xs bg-muted/60 px-2 py-1 rounded inline-block">
                            量化: {env.quantization}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t mt-4 pt-3">
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => handleOpenForm(env)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Edit3 className="w-3.5 h-3.5 mr-1" />
                          编辑
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => handleDelete(env.id)}
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          删除
                        </Button>
                      </div>
                      
                      {onSelect && (
                        <Button 
                          size="sm" 
                          variant={selectedId === env.id ? 'secondary' : 'default'}
                          onClick={() => {
                            onSelect(env.id);
                            setIsOpen(false);
                          }}
                        >
                          选择此环境
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
