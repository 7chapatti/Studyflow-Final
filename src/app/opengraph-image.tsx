import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0F1B2D",
          backgroundImage: "linear-gradient(135deg, #0F1B2D 0%, #1E2D42 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              backgroundColor: "#6366F1",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 64, fontWeight: 700, color: "#F0F4FF" }}>
            StudyFlow
          </div>
        </div>
        <div style={{ fontSize: 30, color: "#C7D0E8", maxWidth: 800, textAlign: "center" }}>
          AI-powered study planner that breaks your assignments into tasks
          and schedules them around your life.
        </div>
      </div>
    ),
    { ...size }
  );
}
