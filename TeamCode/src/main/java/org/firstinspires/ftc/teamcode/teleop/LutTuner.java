package org.firstinspires.ftc.teamcode.teleop;

import com.bylazar.field.FieldManager;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.commands.Commands;
import com.pedropathing.math.Pose;

import org.firstinspires.ftc.teamcode.Robot;
import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.ShooterLut;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;
import org.firstinspires.ftc.teamcode.util.Utilities;

import java.io.IOException;
import java.util.Locale;
import java.util.Map;

import dev.nextftc.robot.Telemetry;
import dev.nextftc.robot.opmode.BulkReadHook;
import dev.nextftc.robot.opmode.NextOpMode;
import dev.nextftc.robot.opmode.NextTeleop;
import dev.nextftc.robot.triggers.Trigger;

/**
 * Teleop for building the shooter LUT. All teleop controls work the same (drive, shoot, intake,
 * unjam, A = reset pose, X = reset field centric, Y = flower bar, guide = turret lock), and dpad
 * up/down changes the RPM by 20.
 *
 * Tuning (gamepad 1 only): dpad left/right = previous/next spot, start = save, back = delete
 *
 * Panels shows every spot: grey = not saved, green = saved, pink ring = the selected spot (same size
 * as the robot circle, so overlap them). Saving stores the distance the robot actually measures, writes
 * /sdcard/FIRST/shooter_lut.csv right away, and moves on to the next spot.
 */
public abstract class LutTuner extends NextOpMode {
    private static final String UNSAVED = "#9E9E9E";
    private static final String SAVED = "#4CAF50";
    private static final String SELECTED = "#E91E63";

    private final Robot robot;
    private final Alliance alliance;
    private final double[][] drawn = Constants.LutTuner.samplePoses;
    private final Pose[] spots;
    private final Map<Integer, ShooterLut.Entry> entries = ShooterLut.load();

    private int selected = 0;
    private String lastAction;

    protected LutTuner(Robot robot, Alliance alliance) {
        super(robot, BulkReadHook.INSTANCE);
        this.robot = robot;
        this.alliance = alliance;

        spots = new Pose[drawn.length];
        for (int i = 0; i < drawn.length; i++) {
            spots[i] = Utilities.poseFactory(alliance).of(drawn[i][0], drawn[i][1], 0);
        }
        lastAction = "loaded " + entries.size() + " saved entries";

        robot.initialize(Utilities.resetPose(alliance), alliance);
        ShotCalculator.useLut = false; // dpad sets the RPM by hand here
        robot.configureBindings(gamepad1, Constants.LutTuner.rpmStep, false);
        robot.drivetrain.setFieldOverlay(this::drawSpots);

        // Everything else on gamepad 1 comes from configureBindings above (dpad up/down = RPM).
        new Trigger(() -> gamepad1.dpad_left).onTrue(Commands.instant(() -> select(selected - 1)));
        new Trigger(() -> gamepad1.dpad_right).onTrue(Commands.instant(() -> select(selected + 1)));
        new Trigger(() -> gamepad1.start).onTrue(Commands.instant(this::saveSelected));
        new Trigger(() -> gamepad1.back).onTrue(Commands.instant(this::deleteSelected));

        loadSelectedRpm();
    }

    private void select(int index) {
        selected = Math.floorMod(index, spots.length);
        loadSelectedRpm();
    }

    /** A saved spot starts from its saved RPM; an unsaved one keeps the current RPM (close to the last spot's). */
    private void loadSelectedRpm() {
        ShooterLut.Entry entry = entries.get(selected);
        if (entry != null) ShotCalculator.setDefaultRpm(entry.rpm);
    }

    private void saveSelected() {
        Follower follower = robot.drivetrain.getFollower();
        if (follower == null) return;
        ShotCalculator.update(follower, alliance);
        double rpm = ShotCalculator.defaultShooterRpm;
        double distance = ShotCalculator.distance;
        entries.put(selected, new ShooterLut.Entry(selected, drawn[selected][0], drawn[selected][1], distance, rpm));
        if (write(String.format(Locale.US, "saved spot %d: %.0f rpm @ %.1f in", selected + 1, rpm, distance))) {
            selected = (selected + 1) % spots.length;
            loadSelectedRpm();
        }
    }

    private void deleteSelected() {
        if (entries.remove(selected) == null) {
            lastAction = "spot " + (selected + 1) + " has nothing saved";
            return;
        }
        write("deleted spot " + (selected + 1));
    }

    private boolean write(String success) {
        try {
            ShooterLut.save(entries.values());
            lastAction = success;
            return true;
        } catch (IOException e) {
            lastAction = "SAVE FAILED: " + e.getMessage() + " (copy the numbers below by hand)";
            return false;
        }
    }

    private void drawSpots(FieldManager field) {
        for (int i = 0; i < spots.length; i++) {
            if (i == selected) continue;
            field.setStyle("transparent", entries.containsKey(i) ? SAVED : UNSAVED, 1.5);
            field.moveCursor(spots[i].x(), spots[i].y());
            field.circle(3);
        }
        Pose spot = spots[selected];
        field.setStyle("transparent", SELECTED, 2.5);
        field.moveCursor(spot.x(), spot.y());
        field.circle(9);
        field.setStyle("transparent", entries.containsKey(selected) ? SAVED : SELECTED, 1.5);
        field.circle(2);
    }

    private void logTuning() {
        Pose spot = spots[selected];
        Pose goal = ShotCalculator.goalFor(spot, alliance);
        ShooterLut.Entry entry = entries.get(selected);

        Telemetry.log("spot", String.format(Locale.US, "%d / %d  (%.0f in from goal)",
                selected + 1, spots.length, Math.hypot(goal.x() - spot.x(), goal.y() - spot.y())));
        Follower follower = robot.drivetrain.getFollower();
        if (follower != null) {
            Pose pose = follower.pose();
            Telemetry.log("off spot (in)", String.format(Locale.US, "%.1f", Math.hypot(spot.x() - pose.x(), spot.y() - pose.y())));
        }
        Telemetry.log("spot saved", entry == null ? "no"
                : String.format(Locale.US, "%.0f rpm @ %.1f in", entry.rpm, entry.distance));
        Telemetry.log("last", lastAction);
        Telemetry.log("--- LUT (" + entries.size() + "/" + spots.length + ") ---");
        for (ShooterLut.Entry e : ShooterLut.sortedByDistance(entries.values())) {
            Telemetry.log(String.format(Locale.US, "%.1f in -> %.0f rpm  (spot %d)", e.distance, e.rpm, e.slot + 1));
        }
    }

    @Override
    public void disabledPeriodic() {
        robot.disabledPeriodic();
        logTuning();
    }

    @Override
    public void start() { robot.set(Robot.State.IDLE).schedule(); }

    @Override
    public void periodic() { logTuning(); }

    @NextTeleop(name = "🎯 Red LUT Tuner")
    public static class Red extends LutTuner {
        public Red(Robot robot) {
            super(robot, Alliance.RED);
        }
    }

    @NextTeleop(name = "🎯 Blue LUT Tuner")
    public static class Blue extends LutTuner {
        public Blue(Robot robot) {
            super(robot, Alliance.BLUE);
        }
    }
}
