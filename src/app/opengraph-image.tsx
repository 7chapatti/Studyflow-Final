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
          backgroundColor: "#182420",
          backgroundImage:
            "linear-gradient(#33413B 1px, transparent 1px), linear-gradient(90deg, #33413B 1px, transparent 1px)",
          backgroundSize: "28px 28px",
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
              borderRadius: 10,
              backgroundColor: "#4F8FC4",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 64, fontWeight: 700, color: "#F3F1E9" }}>
            StudyFlow
          </div>
        </div>
        <div style={{ fontSize: 30, color: "#D7DED3", maxWidth: 800, textAlign: "center" }}>
          AI-powered study planner that breaks your assignments into tasks
          and schedules them around your life.
        </div>
      </div>
    ),
    { ...size }
  );
}
