package org.firstinspires.ftc.teamcode.subsystems;

import com.bylazar.field.FieldManager;
import com.bylazar.field.PanelsField;
import com.pedropathing.drivetrain.DrivePowers;
import com.pedropathing.follower.Follower;
import com.pedropathing.follower.ManualDrive;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.commands.Commands;
import com.pedropathing.ivy.pedro.PedroCommands;
import com.pedropathing.math.Pose;
import com.pedropathing.paths.Path;
import com.pedropathing.revhub.localizers.PinpointConfig;
import com.pedropathing.utils.Angle;
import com.qualcomm.hardware.gobilda.GoBildaPinpointDriver;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.util.RobotLog;

import org.firstinspires.ftc.teamcode.util.Alliance;
import org.firstinspires.ftc.teamcode.util.Constants;
import org.firstinspires.ftc.teamcode.util.ShotCalculator;

import dev.nextftc.hardware.RobotController;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

import dev.nextftc.robot.Mechanism;
import dev.nextftc.robot.Telemetry;

public class Drivetrain implements Mechanism {
    private static final long FIELD_DRAW_INTERVAL_NANOS = 100_000_000L; // 10 Hz

    private Follower follower;
    private long lastFieldDraw;
    private Consumer<FieldManager> fieldOverlay;

    private double headingOffset = 0;
    private double speed = 1.0;
    private double assistTarget = Double.NaN; // NaN = heading assist not holding

    // Pose-jump guard: the Pinpoint can glitch or restart (e.g. on a power dip) and Pedro takes
    // whatever it reports, usually (0, 0, 0). That throws off field centric and turret aim at once.
    // A move faster than the robot can physically go is treated as a glitch and undone.
    private static final double MAX_SPEED_IN_PER_S = 200;   // robot tops out around 76
    private static final double MAX_TURN_RAD_PER_S = 20;    // ~1150 deg/s
    private GoBildaPinpointDriver pinpoint;
    private Pose lastGoodPose;
    private long lastCheckNanos;
    private int poseJumps;
    private String lastJump = "";

    public void initialize(Pose startPose) {
        follower = Constants.create(RobotController.hardwareMap());
        follower.setPose(startPose);
        try {
            pinpoint = RobotController.hardwareMap().get(GoBildaPinpointDriver.class, Constants.Drivetrain.pinpointConfig.name.get());
        } catch (RuntimeException e) {
            pinpoint = null;
        }
        lastGoodPose = startPose;
        lastCheckNanos = System.nanoTime();
        poseJumps = 0;
        lastJump = "";
        fieldOverlay = null;
        headingOffset = 0;
        speed = 1.0;
        assistTarget = Double.NaN;
    }

    /** Extra shapes drawn on the Panels field each frame, after the robot and goal. */
    public void setFieldOverlay(Consumer<FieldManager> overlay) {
        fieldOverlay = overlay;
    }

    public Follower getFollower() {
        return follower;
    }

    /**
     * Field-centric teleop drive.
     * @param headingAssist while true and the driver isn't turning, hold a locked heading (see
     *                      {@link Constants.Drivetrain.HeadingAssist})
     */
    public Command drive(Gamepad gamepad, Alliance alliance, BooleanSupplier headingAssist) {
        return infinite(() -> {
            double heading = follower.pose().heading();
            double turn = -gamepad.right_stick_x * speed;
            boolean driverTurning = Math.abs(gamepad.right_stick_x) > Constants.Drivetrain.HeadingAssist.stickDeadband;

            if (headingAssist.getAsBoolean() && !driverTurning) {
                if (Double.isNaN(assistTarget)) assistTarget = assistTarget(heading);
                turn = holdHeadingPower(heading, assistTarget);
                Telemetry.log("heading assist (deg)", Math.round(Math.toDegrees(Angle.normalizeSigned(assistTarget))));
            } else {
                assistTarget = Double.NaN;
            }

            DrivePowers input = new DrivePowers(-gamepad.left_stick_y * speed, -gamepad.left_stick_x * speed, turn);
            follower.manual(ManualDrive.fieldCentric(input, heading, alliance.fieldCentricOffset + headingOffset));
        });
    }

    /** Nearest multiple of 90 deg if close enough, otherwise the current heading. */
    private static double assistTarget(double heading) {
        double quarter = Math.PI / 2;
        double snapped = Math.round(heading / quarter) * quarter;
        double offBy = Math.abs(Angle.normalizeSigned(snapped - heading));
        return offBy <= Math.toRadians(Constants.Drivetrain.HeadingAssist.snapWindowDeg) ? snapped : heading;
    }

    /** P control toward target; positive turn = CCW, matching Pedro heading. */
    private static double holdHeadingPower(double heading, double target) {
        double error = Angle.normalizeSigned(target - heading);
        if (Math.abs(error) < Math.toRadians(Constants.Drivetrain.HeadingAssist.toleranceDeg)) return 0;
        double max = Constants.Drivetrain.HeadingAssist.maxTurn;
        return Math.max(-max, Math.min(max, Constants.Drivetrain.HeadingAssist.kP * error));
    }

    public Command resetFieldCentric(Alliance alliance) {
        return Commands.instant(() -> headingOffset = -follower.pose().heading() - alliance.fieldCentricOffset);
    }

    /**
     * Snap to the wall reset pose and re-seed field centric so driver forward is the way the
     * robot faces at the reset pose (same as {@link #resetFieldCentric} from that spot).
     */
    public Command resetToWall(Pose pose, Alliance alliance) {
        return Commands.instant(() -> {
            setPose(pose);
            headingOffset = -pose.heading() - alliance.fieldCentricOffset;
        });
    }

    public Command resetPose(Pose pose) {
        return Commands.instant(() -> setPose(pose));
    }

    private void setPose(Pose pose) {
        follower.setPose(pose);
        lastGoodPose = pose; // intentional jump, not a glitch
        lastCheckNanos = System.nanoTime();
    }

    public Command setSpeed(double speed) {
        return Commands.instant(() -> this.speed = speed);
    }

    public Command follow(Path path) {
        return PedroCommands.follow(follower, path).requiring(this);
    }

    public Command hold() {
        return PedroCommands.hold(follower).requiring(this);
    }

    @Override
    public void periodic() {
        if (follower != null) {
            follower.update();
            checkLocalizer();
            publishPose();
        }
    }

    private void checkLocalizer() {
        long now = System.nanoTime();
        double dt = Math.max((now - lastCheckNanos) / 1e9, 0.005);
        lastCheckNanos = now;

        Pose pose = follower.pose();
        String reason = null;
        if (!Double.isFinite(pose.x()) || !Double.isFinite(pose.y()) || !Double.isFinite(pose.heading())) {
            reason = "NaN pose";
        } else if (lastGoodPose != null) {
            double speed = Math.hypot(pose.x() - lastGoodPose.x(), pose.y() - lastGoodPose.y()) / dt;
            double turn = Math.abs(Angle.normalizeSigned(pose.heading() - lastGoodPose.heading())) / dt;
            if (speed > MAX_SPEED_IN_PER_S || turn > MAX_TURN_RAD_PER_S) {
                reason = String.format(java.util.Locale.US, "%.0f in/s, %.0f deg/s", speed, Math.toDegrees(turn));
            }
        }

        GoBildaPinpointDriver.DeviceStatus status = pinpoint == null ? null : pinpoint.getDeviceStatus();
        if (reason != null && lastGoodPose != null) {
            poseJumps++;
            lastJump = String.format(java.util.Locale.US, "(%.1f, %.1f, %.0f deg) -> (%.1f, %.1f, %.0f deg), %s",
                    lastGoodPose.x(), lastGoodPose.y(), Math.toDegrees(lastGoodPose.heading()),
                    pose.x(), pose.y(), Math.toDegrees(pose.heading()), reason);
            RobotLog.ww("BioBuzz", "Pose jump #%d undone: %s, pinpoint %s, battery %s",
                    poseJumps, lastJump, status, batteryVoltage());
            restorePinpoint();
        } else {
            lastGoodPose = pose;
        }

        if (poseJumps > 0 || (status != null && status != GoBildaPinpointDriver.DeviceStatus.READY)) {
            Telemetry.log("WARNING localizer", "pinpoint " + status + ", pose jumps undone: " + poseJumps);
            if (poseJumps > 0) Telemetry.log("last jump", lastJump);
        }
    }

    /**
     * After a Pinpoint restart its pod setup is back to defaults and its pose is zeroed, so
     * re-send the setup and put the last good pose back.
     */
    private void restorePinpoint() {
        if (pinpoint != null) {
            PinpointConfig c = Constants.Drivetrain.pinpointConfig;
            pinpoint.setOffsets(c.xPodOffset.get(), c.yPodOffset.get(), c.offsetUnits.get());
            pinpoint.setEncoderResolution(c.podType.get());
            pinpoint.setEncoderDirections(c.xPodDirection.get(), c.yPodDirection.get());
        }
        follower.setPose(lastGoodPose);
    }

    private static String batteryVoltage() {
        try {
            return String.valueOf(RobotController.INSTANCE.getInputVoltage());
        } catch (RuntimeException e) {
            return "?";
        }
    }

    private void publishPose() {
        Pose pose = follower.pose();
        Pose goal = ShotCalculator.goalPose;

        long now = System.nanoTime();
        if (now - lastFieldDraw < FIELD_DRAW_INTERVAL_NANOS) return;
        lastFieldDraw = now;

        FieldManager field = PanelsField.INSTANCE.getField();
        field.setOffsets(PanelsField.INSTANCE.getPresets().getPEDRO_PATHING());
        field.setStyle("transparent", "#3F51B5", 1.5);
        field.moveCursor(pose.x(), pose.y());
        field.circle(9);
        field.line(pose.x() + 9 * Math.cos(pose.heading()), pose.y() + 9 * Math.sin(pose.heading()));

        if (goal != null) {
            field.setStyle("transparent", "#FF9800", 1.5);
            field.moveCursor(goal.x(), goal.y());
            field.circle(3);
        }

        if (fieldOverlay != null) fieldOverlay.accept(field);

        field.update();
    }
}
