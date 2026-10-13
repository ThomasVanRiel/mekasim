import { describe, expect, it } from "vitest";
import { motionPlots, positionMeasures, SHEET, speedMeasure } from "./coordinates.ts";

describe("what is plotted and measured in the chosen coordinates", () => {
  it("is along x and y of the sheet unless something else is chosen", () => {
    expect(motionPlots("rod.B", "rod_B", SHEET)).toEqual([
      {
        label: "movement",
        name: "rod_B_movement",
        series: ["change(x(rod.B))", "change(y(rod.B))", "moved(rod.B)"],
      },
      { label: "speed", name: "rod_B_speed", series: ["vx(rod.B)", "vy(rod.B)", "v(rod.B)"] },
      {
        label: "acceleration",
        name: "rod_B_accel",
        series: ["ax(rod.B)", "ay(rod.B)", "a(rod.B)"],
      },
      { label: "jerk", name: "rod_B_jerk", series: ["jx(rod.B)", "jy(rod.B)", "j(rod.B)"] },
    ]);
    expect(positionMeasures("rod", "rod", SHEET).items).toEqual([
      ["rod_dx", "change(x(rod))"],
      ["rod_dy", "change(y(rod))"],
      ["rod_moved", "moved(rod)"],
    ]);
    expect(speedMeasure("rod.B", "rod_B", SHEET).items).toEqual([["rod_B_speed", "v(rod.B)"]]);
  });

  it("names the frame after the point, and in the name of what it adds", () => {
    const [movement, speed] = motionPlots("rod.B", "rod_B", { frame: "slope", polar: false });
    expect(movement).toEqual({
      label: "movement",
      name: "rod_B_movement_in_slope",
      series: ["change(x(rod.B, slope))", "change(y(rod.B, slope))", "moved(rod.B, slope)"],
    });
    expect(speed?.series).toEqual(["vx(rod.B, slope)", "vy(rod.B, slope)", "v(rod.B, slope)"]);
    expect(speedMeasure("rod.B", "rod_B", { frame: "slope", polar: false }).items).toEqual([
      ["rod_B_speed_in_slope", "v(rod.B, slope)"],
    ]);
  });

  it("gives a radius and an angle, and the parts along and across the radius", () => {
    expect(motionPlots("rod.B", "rod_B", { polar: true }).slice(0, 2)).toEqual([
      { label: "position", name: "rod_B_position_polar", series: ["r(rod.B)", "theta(rod.B)"] },
      { label: "speed", name: "rod_B_speed_polar", series: ["vr(rod.B)", "vt(rod.B)", "v(rod.B)"] },
    ]);
    const polar = { frame: "cam", polar: true };
    expect(motionPlots("lifter.P", "lifter_P", polar)[2]).toEqual({
      label: "acceleration",
      name: "lifter_P_accel_polar_in_cam",
      series: ["ar(lifter.P, cam)", "at(lifter.P, cam)", "a(lifter.P, cam)"],
    });
    expect(positionMeasures("lifter.P", "lifter_P", polar)).toEqual({
      label: "position",
      items: [
        ["lifter_P_r_in_cam", "r(lifter.P, cam)"],
        ["lifter_P_theta_in_cam", "theta(lifter.P, cam)"],
      ],
    });
  });
});
