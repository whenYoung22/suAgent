import { Button, Input, Typography } from "antd";
import "./index.css";

const { TextArea } = Input;

interface ChatComposerProps {
  prompt: string;
  isRunning: boolean;
  disabled?: boolean;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}

export function ChatComposer({
  prompt,
  isRunning,
  disabled = false,
  onPromptChange,
  onSubmit,
  onStop,
}: ChatComposerProps) {
  return (
    <div className="composer-wrap">
      <div className="composer">
        <TextArea
          aria-label="输入消息"
          placeholder="输入问题开始对话；Mock 模式也可输入 1–4 选择演示场景…"
          value={prompt}
          disabled={disabled}
          autoSize={{ minRows: 1, maxRows: 5 }}
          onChange={(event) => onPromptChange(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <Typography.Text className="composer-note" type="secondary">
          Mock 模式：1 单次工具调用 · 2 连续工具调用 · 3 工具失败 · 4 流式错误。
          Enter 发送，Shift + Enter 换行。
        </Typography.Text>
        
        {isRunning ? (
          <Button className="composer-stop-button" onClick={onStop}>
            停止
          </Button>
        ) : (
          <Button
            className="composer-send-button"
            type="primary"
            onClick={onSubmit}
            disabled={disabled || !prompt.trim()}
          >
            发送
          </Button>
        )}
      </div>
    </div>
  );
}
